import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { createSignalWorker, signalQueue } from "../src/workers/processSignals.js";
import { regradeQueue } from "../src/workers/regradeWorker.js";

// createSignalWorker listens on the hardcoded "process-signals" BullMQ queue name — every test
// file that spins one up shares that same queue in the same real Redis instance. Without a
// dedicated logical DB per file, vitest running these files concurrently lets one file's worker
// steal and process a job another file added, using the wrong (or no) LLM mock. A unique `db`
// index per file gives each one a fully isolated Redis key space, closing that race.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 1 });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `worker-test-tenant-${runId}`;
const batchId = `worker-test-batch-${runId}`;
const workUnitId = `worker-test-unit-${runId}`;
const graderId = `grader-${runId}`;

// A second work unit for the same grader, in a different domain, so the multi-item test below
// can prove domainStats accumulates across items instead of freezing after the first one.
const secondWorkUnitId = `worker-test-unit-2-${runId}`;

let worker: ReturnType<typeof createSignalWorker>;

beforeAll(async () => {
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
  await prisma.workUnit.create({
    data: {
      id: workUnitId,
      tenantId,
      batchId,
      domain: "math",
      task: "2 + 2",
      rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
      modelOutput: "4",
      grade: {
        score: 9,
        maxScore: 10,
        // Deliberately fires the heuristic consistency signal (high score +
        // negative-sentiment reasoning) so this unit is excluded from the
        // worker's LLM spot-check sampling — keeps this test fast and free
        // of a real LLM call.
        reasoning: "This response is wrong and contains an error.",
      },
      graderId,
      createdAt: new Date(),
    },
  });
  await prisma.workUnit.create({
    data: {
      id: secondWorkUnitId,
      tenantId,
      batchId,
      domain: "code",
      task: "reverse a string",
      rubric: [{ id: "r1", text: "Correct output", required: true, weight: 1 }],
      modelOutput: "def reverse(s): return s[::-1]",
      grade: {
        score: 9,
        maxScore: 10,
        reasoning: "This response is wrong and contains an error.",
      },
      graderId,
      createdAt: new Date(),
    },
  });

  worker = createSignalWorker(prisma, redis, regradeQueue(redis));
  await worker.waitUntilReady();
  await signalQueue(redis).add("process-signals", { batchId, tenantId });
});

afterAll(async () => {
  await worker.close();
  await prisma.signal.deleteMany({ where: { workUnitId: { in: [workUnitId, secondWorkUnitId] } } });
  await prisma.verdict.deleteMany({ where: { workUnitId: { in: [workUnitId, secondWorkUnitId] } } });
  await prisma.workUnit.deleteMany({ where: { id: { in: [workUnitId, secondWorkUnitId] } } });
  await prisma.batch.deleteMany({ where: { id: batchId } });
  await prisma.graderStat.deleteMany({ where: { tenantId } });
  await prisma.$disconnect();
  await redis.quit();
});

async function pollUntil<T>(fn: () => Promise<T | null>, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for worker to process the job");
}

describe("processSignals worker", () => {
  it("writes signals and a verdict for a queued batch", async () => {
    const verdict = await pollUntil(() => prisma.verdict.findUnique({ where: { workUnitId } }));
    expect(verdict.recommendation).toBeTruthy();
    expect(verdict.risk).toBeGreaterThan(0);

    const signals = await prisma.signal.findMany({ where: { workUnitId } });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.tenantId === tenantId)).toBe(true);

    const consistency = signals.find((s) => s.key === "consistency");
    expect(consistency?.fired).toBe(true);
  });

  it("leaves the batch status \"pending\" while a flagged item's regrade is still outstanding", async () => {
    // The fixture's fired consistency signal (weight 0.5) puts risk at 0.5, above the 0.4
    // regrade threshold, so both units get queued for regrade — no regradeWorker consumes
    // that queue in this test, so the batch must not be marked "done" until one does.
    await pollUntil(() => prisma.verdict.findUnique({ where: { workUnitId } }));
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("pending");
  });

  it("accumulates domainStats per-domain across multiple items for the same grader, not just the first", async () => {
    const stat = await pollUntil(async () => {
      const s = await prisma.graderStat.findUnique({ where: { tenantId_graderId: { tenantId, graderId } } });
      return s && s.itemsSeen >= 2 ? s : null;
    });

    expect(stat.itemsSeen).toBe(2);
    // Both units deliberately fire the heuristic consistency signal (see comment above), so
    // flagCount is 1 for each domain — the point here is that domainStats has an entry for
    // BOTH domains at all (previously only the first-ever domain was ever recorded).
    const domainStats = stat.domainStats as Record<string, { itemsSeen: number; flagCount: number }>;
    expect(domainStats.math).toEqual({ itemsSeen: 1, flagCount: 1 });
    expect(domainStats.code).toEqual({ itemsSeen: 1, flagCount: 1 });
  });
});

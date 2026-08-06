import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { createSignalWorker, signalQueue } from "../src/workers/processSignals.js";

// createSignalWorker listens on the hardcoded "process-signals" BullMQ queue name — every test
// file that spins one up shares that same queue in the same real Redis instance. Without a
// dedicated logical DB per file, vitest running these files concurrently lets one file's worker
// steal and process a job another file added, using the wrong (or no) mock. A unique `db` index
// per file gives each one a fully isolated Redis key space, closing that race.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 6 });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `signal-retry-test-tenant-${runId}`;
const batchId = `signal-retry-test-batch-${runId}`;
const graderId = `signal-retry-test-grader-${runId}`;
const firstUnitId = `signal-retry-test-unit-1-${runId}`;
const secondUnitId = `signal-retry-test-unit-2-${runId}`;

let worker: ReturnType<typeof createSignalWorker>;

// Simulates a transient failure (e.g. a Redis blip enqueuing the regrade job for the *first*
// unit processed) partway through the job's per-unit loop, after that unit's Signal/Verdict/
// GraderStat transaction has already committed. The whole job handler throws, so BullMQ retries
// it from the top — this is what exercises the retry-idempotency path in processSignals.ts
// (skipping already-processed units instead of redoing their GraderStat increment).
let regradeAddCalls = 0;
const regradeQueueMock = {
  add: vi.fn(async (...args: unknown[]) => {
    regradeAddCalls++;
    if (regradeAddCalls === 1) throw new Error("simulated transient regrade-queue failure");
    return args;
  }),
};

let jobCompleted = false;
let jobFailedCount = 0;

beforeAll(async () => {
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
  // Both units fire the heuristic consistency signal (weight 0.5 >= the 0.4 regrade threshold)
  // and belong to the same grader but different domains — this exercises both the per-unit
  // GraderStat accumulation and the regrade-queue dedup logic across a retry.
  for (const [id, domain] of [
    [firstUnitId, "math"],
    [secondUnitId, "code"],
  ] as const) {
    await prisma.workUnit.create({
      data: {
        id,
        tenantId,
        batchId,
        domain,
        task: "task",
        rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
        modelOutput: "output",
        grade: { score: 9, maxScore: 10, reasoning: "This response is wrong and contains an error." },
        graderId,
        createdAt: new Date(),
      },
    });
  }

  worker = createSignalWorker(prisma, redis, regradeQueueMock as never);
  worker.on("completed", () => {
    jobCompleted = true;
  });
  worker.on("failed", () => {
    jobFailedCount++;
  });
  await worker.waitUntilReady();
  await signalQueue(redis).add("process-signals", { batchId, tenantId }, { attempts: 3 });
});

afterAll(async () => {
  await worker.close();
  await prisma.signal.deleteMany({ where: { workUnitId: { in: [firstUnitId, secondUnitId] } } });
  await prisma.verdict.deleteMany({ where: { workUnitId: { in: [firstUnitId, secondUnitId] } } });
  await prisma.workUnit.deleteMany({ where: { id: { in: [firstUnitId, secondUnitId] } } });
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

describe("processSignals worker — retry idempotency", () => {
  it("retries after a transient mid-loop failure and does not double-count GraderStat for the unit processed before the crash", async () => {
    await pollUntil(async () => (jobCompleted ? true : null));

    // The job failed once (attempt 1, on the first unit's regrade-queue call) and succeeded on
    // the retry (attempt 2) — proving `{ attempts: 3 }` on the enqueue actually causes a retry
    // rather than permanently stranding the batch.
    expect(jobFailedCount).toBe(1);

    const stat = await prisma.graderStat.findUniqueOrThrow({
      where: { tenantId_graderId: { tenantId, graderId } },
    });
    // Without the retry-idempotency fix, the unit whose transaction committed on attempt 1 would
    // be reprocessed from scratch on attempt 2, double-counting its GraderStat increment: 3
    // instead of the correct 2 (one per unit, each counted exactly once).
    expect(stat.itemsSeen).toBe(2);
    expect(stat.flagCount).toBe(2);
    const domainStats = stat.domainStats as Record<string, { itemsSeen: number; flagCount: number }>;
    expect(domainStats.math).toEqual({ itemsSeen: 1, flagCount: 1 });
    expect(domainStats.code).toEqual({ itemsSeen: 1, flagCount: 1 });

    // Both units still end up with exactly one Verdict/Signal set each, and both still get
    // queued for regrade despite the mid-loop failure — the narrow "committed but never queued"
    // gap the retry path also has to recover from.
    const verdicts = await prisma.verdict.findMany({ where: { workUnitId: { in: [firstUnitId, secondUnitId] } } });
    expect(verdicts).toHaveLength(2);
    const signals = await prisma.signal.findMany({ where: { workUnitId: { in: [firstUnitId, secondUnitId] } } });
    expect(signals.filter((s) => s.workUnitId === firstUnitId)).toHaveLength(3);
    expect(signals.filter((s) => s.workUnitId === secondUnitId)).toHaveLength(3);
  });
});

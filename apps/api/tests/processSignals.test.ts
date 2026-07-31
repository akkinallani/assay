import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { createSignalWorker, signalQueue } from "../src/workers/processSignals.js";
import { regradeQueue } from "../src/workers/regradeWorker.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `worker-test-tenant-${runId}`;
const batchId = `worker-test-batch-${runId}`;
const workUnitId = `worker-test-unit-${runId}`;

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
      graderId: `grader-${runId}`,
      createdAt: new Date(),
    },
  });

  worker = createSignalWorker(prisma, redis, regradeQueue(redis));
  await worker.waitUntilReady();
  await signalQueue(redis).add("process-signals", { batchId, tenantId });
});

afterAll(async () => {
  await worker.close();
  await prisma.signal.deleteMany({ where: { workUnitId } });
  await prisma.verdict.deleteMany({ where: { workUnitId } });
  await prisma.workUnit.deleteMany({ where: { id: workUnitId } });
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

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("done");
  });
});

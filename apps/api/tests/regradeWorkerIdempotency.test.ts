import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

// regrade jobs are enqueued with `attempts: 3` (see processSignals.ts). If a transient failure
// throws *after* the worker's DB transaction has already committed the "regrade" signal and
// incremented GraderStat, BullMQ retries the whole handler from scratch. Without a dedup guard,
// that retry re-runs the (expensive) LLM grading loop and writes a second, duplicate signal row
// plus a second GraderStat increment. This test seeds a work unit that already has a "regrade"
// signal — standing in for "a previous attempt already succeeded" — and enqueues a fresh job for
// the same unit, asserting the worker skips reprocessing entirely rather than double-writing.
const llmCallMock = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    score: 8,
    maxScore: 10,
    reasoning: "Looks solid.",
    criteriaScores: [{ criterionId: "r1", met: true, justification: "Addressed." }],
  }),
});
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { createRegradeWorker, regradeQueue } = await import("../src/workers/regradeWorker.js");

// Own logical Redis db so this file's queue/worker can't race another test file's, mirroring the
// isolation fix in the other process-signals/regrade test files.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 4 });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `regrade-idempotency-test-tenant-${runId}`;
const batchId = `regrade-idempotency-test-batch-${runId}`;
const workUnitId = `regrade-idempotency-test-unit-${runId}`;
const graderId = `grader-${runId}`;

let worker: ReturnType<typeof createRegradeWorker>;
let jobCompleted = false;

beforeAll(async () => {
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
  await prisma.workUnit.create({
    data: {
      id: workUnitId,
      tenantId,
      batchId,
      domain: "general",
      task: "Summarize the article",
      rubric: [{ id: "r1", text: "Cites specific numerical data points", required: true, weight: 1 }],
      modelOutput: "The article is about X.",
      grade: { score: 7, maxScore: 10, reasoning: "Adequate summary, covers the main point." },
      graderId,
      createdAt: new Date(),
    },
  });
  await prisma.verdict.create({
    data: { tenantId, workUnitId, risk: 0.5, recommendation: "regrade" },
  });
  // Simulates a regrade job that already completed once — the exact state a retried job would
  // find if it re-ran after the DB transaction had already committed.
  await prisma.signal.create({
    data: { tenantId, workUnitId, key: "regrade", fired: true, weight: 0.3, evidence: "Prior run" },
  });
  await prisma.graderStat.create({
    data: { tenantId, graderId, itemsSeen: 1, flagCount: 1, agreementCount: 0, regradeCount: 1 },
  });

  worker = createRegradeWorker(prisma, redis);
  worker.on("completed", () => {
    jobCompleted = true;
  });
  await worker.waitUntilReady();
  await regradeQueue(redis).add("regrade-item", { workUnitId, batchId }, { attempts: 3 });
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

describe("regradeWorker — retry idempotency", () => {
  it("skips reprocessing (no duplicate signal, no double-counted stats, no LLM call) when the unit was already regraded", async () => {
    await pollUntil(async () => (jobCompleted ? true : null));

    expect(llmCallMock).not.toHaveBeenCalled();

    const signals = await prisma.signal.findMany({ where: { workUnitId, key: "regrade" } });
    expect(signals).toHaveLength(1);

    const stat = await prisma.graderStat.findUniqueOrThrow({ where: { tenantId_graderId: { tenantId, graderId } } });
    expect(stat.regradeCount).toBe(1);
    expect(stat.agreementCount).toBe(0);
  });
});

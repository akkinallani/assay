import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

// A permanently-failed regrade (the agent never produces a parseable grade, or the LLM backend
// is unreachable on every retry) never wrote a "regrade" signal — computeBatchProgress's
// regradeDone count (Signal.count({ key: "regrade" })) would never reach flaggedForRegrade for
// that unit, so refreshBatchProgress could never mark the batch "done" and the live view stayed
// stuck showing the unit as permanently "regrading" forever. This is the gap flagged and left
// open in docs/session-log.md's 2026-08-05 (5) entry. These tests assert both terminal-failure
// paths now write a fired:false "regrade" marker so the batch can actually finish.
const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { createRegradeWorker, regradeQueue } = await import("../src/workers/regradeWorker.js");

// Own logical Redis db so this file's queue/worker can't race another test file's (see the
// 2026-08-06 (9) session-log entry on the shared-Redis-db worker race).
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 5 });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `regrade-terminal-test-tenant-${runId}`;
const graderId = `grader-${runId}`;

let worker: ReturnType<typeof createRegradeWorker>;

async function seedUnit(workUnitId: string, batchId: string) {
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
    data: { tenantId, workUnitId, risk: 0.5, recommendation: "re_review" },
  });
}

beforeAll(async () => {
  await prisma.graderStat.create({
    data: { tenantId, graderId, itemsSeen: 2, flagCount: 2, agreementCount: 0, regradeCount: 0 },
  });
  worker = createRegradeWorker(prisma, redis);
  await worker.waitUntilReady();
});

beforeEach(() => {
  llmCallMock.mockReset();
});

afterAll(async () => {
  await worker.close();
  await prisma.signal.deleteMany({ where: { tenantId } });
  await prisma.verdict.deleteMany({ where: { tenantId } });
  await prisma.workUnit.deleteMany({ where: { tenantId } });
  await prisma.batch.deleteMany({ where: { tenantId } });
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

describe("regradeWorker — terminal failure accounting", () => {
  it("marks the batch done after an unparseable agent response, instead of hanging forever", async () => {
    const workUnitId = `unit-parse-fail-${runId}`;
    const batchId = `batch-parse-fail-${runId}`;
    await seedUnit(workUnitId, batchId);

    // Every llmCall (the one tool-turn-loop call, plus llmCallStructured's two internal retry
    // attempts) returns content with no JSON in it, so llmCallStructured exhausts its retries
    // and throws LlmParseError.
    llmCallMock.mockResolvedValue({ content: "I've reviewed it and it seems fine overall." });

    let completed = false;
    worker.on("completed", (job) => {
      if (job.data.workUnitId === workUnitId) completed = true;
    });
    await regradeQueue(redis).add("regrade-item", { workUnitId, batchId }, { attempts: 3 });

    await pollUntil(async () => (completed ? true : null));

    const signals = await prisma.signal.findMany({ where: { workUnitId, key: "regrade" } });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.fired).toBe(false);

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("done");
  });

  it("marks the batch done after the LLM backend fails on every retry, instead of hanging forever", async () => {
    const workUnitId = `unit-all-retries-fail-${runId}`;
    const batchId = `batch-all-retries-fail-${runId}`;
    await seedUnit(workUnitId, batchId);

    llmCallMock.mockRejectedValue(new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434"));

    let failed = false;
    worker.on("failed", (job) => {
      if (job?.data.workUnitId === workUnitId) failed = true;
    });
    // Small attempts count so the (immediate, no-backoff) retries finish quickly in test.
    await regradeQueue(redis).add("regrade-item", { workUnitId, batchId }, { attempts: 2 });

    await pollUntil(async () => (failed ? true : null));

    const signals = await prisma.signal.findMany({ where: { workUnitId, key: "regrade" } });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.fired).toBe(false);
    expect(llmCallMock).toHaveBeenCalledTimes(2);

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("done");
  });
});

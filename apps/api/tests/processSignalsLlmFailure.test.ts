import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

// Simulates the LLM backend being unreachable (e.g. Ollama down or a network error) rather
// than returning a malformed response — checkConsistencyWithLLM already handles the latter
// (LlmParseError) internally, but a plain connection failure previously propagated straight
// out of the consistency spot-check and aborted the whole process-signals job.
const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { createSignalWorker, signalQueue } = await import("../src/workers/processSignals.js");
const { regradeQueue } = await import("../src/workers/regradeWorker.js");

// createSignalWorker listens on the hardcoded "process-signals" BullMQ queue name — every test
// file that spins one up shares that same queue in the same real Redis instance. Without a
// dedicated logical DB per file, vitest running these files concurrently lets one file's worker
// steal and process a job another file added, using the wrong (or no) LLM mock. A unique `db`
// index per file gives each one a fully isolated Redis key space, closing that race.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 2 });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `llm-failure-test-tenant-${runId}`;
const batchId = `llm-failure-test-batch-${runId}`;
const workUnitId = `llm-failure-test-unit-${runId}`;

let worker: ReturnType<typeof createSignalWorker>;

// The worker's job handler runs two sequential async loops (see processSignals.ts) — the first
// loop's DB writes (which is all a `verdict` row's existence proves) complete well before the
// second, LLM-backed spot-check loop that this test actually exercises does. Waiting on that
// intermediate DB state instead of the job's real completion is a race: it can read a consistent
// snapshot before the second loop has run at all, especially on a slower CI runner. Waiting for
// the worker's own "completed" event is what actually guarantees the whole handler has returned.
let jobCompleted = false;

beforeAll(async () => {
  llmCallMock.mockRejectedValue(new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434"));

  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
  await prisma.workUnit.create({
    data: {
      id: workUnitId,
      tenantId,
      batchId,
      domain: "general",
      task: "Summarize the article",
      rubric: [{ id: "r1", text: "Accurate summary", required: true, weight: 1 }],
      modelOutput: "The article is about X.",
      // Mid-range score (70%) so the free heuristic's consistency signal cannot fire either
      // way (it only triggers above 85% or below 35%) — this makes the unit a spot-check
      // candidate, which is what exercises the LLM call this test is failing.
      grade: { score: 7, maxScore: 10, reasoning: "Adequate summary, covers the main point." },
      graderId: `grader-${runId}`,
      createdAt: new Date(),
    },
  });

  worker = createSignalWorker(prisma, redis, regradeQueue(redis));
  worker.on("completed", () => {
    jobCompleted = true;
  });
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

describe("processSignals worker — consistency spot-check LLM failure", () => {
  it("completes the batch instead of aborting when the LLM backend is unreachable", async () => {
    await pollUntil(async () => (jobCompleted ? true : null));

    const verdict = await prisma.verdict.findUnique({ where: { workUnitId } });
    expect(verdict?.recommendation).toBeTruthy();

    expect(llmCallMock).toHaveBeenCalled();

    // The consistency signal (from the free heuristic, which ran before the failed LLM
    // spot-check) must still be present and untouched by the failed audit.
    const signals = await prisma.signal.findMany({ where: { workUnitId } });
    const consistency = signals.find((s) => s.key === "consistency");
    expect(consistency?.fired).toBe(false);

    // Nothing was flagged for regrade in this fixture, so the batch should still reach
    // "done" — proving the failed spot-check didn't strand it at "pending" forever.
    const batch = await pollUntil(async () => {
      const b = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      return b.status === "done" ? b : null;
    });
    expect(batch.status).toBe("done");
  });
});

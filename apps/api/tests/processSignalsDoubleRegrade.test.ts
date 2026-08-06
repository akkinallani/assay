import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

// A work unit whose heuristic coverage signal already crosses the regrade threshold (queuing a
// regrade job in the worker's first loop) but whose heuristic consistency signal doesn't fire —
// making it eligible for the LLM spot-check in the second loop. If that audit also flags it,
// the pre-fix code queued a *second*, independent regrade job for the same unit: regradeWorker
// has no dedup of its own, so this doubled the LLM cost and double-counted the "regrade" signal's
// weight in the final risk score.
const llmCallMock = vi.fn().mockResolvedValue({
  content: JSON.stringify({ consistent: false, evidence: "The reasoning does not address the required detail." }),
});
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { createSignalWorker, signalQueue } = await import("../src/workers/processSignals.js");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `double-regrade-test-tenant-${runId}`;
const batchId = `double-regrade-test-batch-${runId}`;
const workUnitId = `double-regrade-test-unit-${runId}`;

let worker: ReturnType<typeof createSignalWorker>;
const regradeQueueMock = { add: vi.fn().mockResolvedValue(undefined) };

beforeAll(async () => {
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
  await prisma.workUnit.create({
    data: {
      id: workUnitId,
      tenantId,
      batchId,
      domain: "general",
      task: "Summarize the article",
      // Keywords ("cites", "specific", "numerical") never appear in the reasoning below, so the
      // free heuristic's coverage signal fires on its own (weight 0.5 >= the 0.4 regrade
      // threshold) — this is what queues the first regrade job.
      rubric: [{ id: "r1", text: "Cites specific numerical data points", required: true, weight: 1 }],
      modelOutput: "The article is about X.",
      // Mid-range score (70%) so the heuristic consistency signal cannot fire either way,
      // making this unit a spot-check candidate — the LLM mock above then flags it too.
      grade: { score: 7, maxScore: 10, reasoning: "Adequate summary, covers the main point." },
      graderId: `grader-${runId}`,
      createdAt: new Date(),
    },
  });

  worker = createSignalWorker(prisma, redis, regradeQueueMock as never);
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

describe("processSignals worker — double regrade queuing", () => {
  it("queues only one regrade job when both the heuristic and the LLM spot-check flag the same unit", async () => {
    await pollUntil(async () => {
      const v = await prisma.verdict.findUnique({ where: { workUnitId } });
      return v && v.risk > 0 ? v : null;
    });

    // Both the coverage signal (from the first loop) and the flipped consistency signal (from
    // the spot-check loop) independently cross the 0.4 regrade threshold — without the fix this
    // asserts 2 calls, proving the dedup guard is what keeps it at 1.
    expect(llmCallMock).toHaveBeenCalled();
    expect(regradeQueueMock.add).toHaveBeenCalledTimes(1);
    expect(regradeQueueMock.add).toHaveBeenCalledWith(
      "regrade-item",
      { workUnitId, batchId },
      { attempts: 3 }
    );
  });
});

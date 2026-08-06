import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { refreshBatchProgress } from "../src/events/bus.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `progress-test-tenant-${runId}`;
const batchId = `progress-test-batch-${runId}`;
const flaggedUnitId = `progress-test-unit-flagged-${runId}`;
const clearUnitId = `progress-test-unit-clear-${runId}`;

async function waitForMessage(channel: string, timeoutMs = 5000): Promise<string> {
  const sub = redis.duplicate();
  await sub.subscribe(channel);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for a pub/sub message")), timeoutMs);
      sub.on("message", (_ch, message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  } finally {
    await sub.unsubscribe(channel).catch(() => {});
    await sub.quit().catch(() => {});
  }
}

beforeAll(async () => {
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });

  const unitData = (id: string) => ({
    id,
    tenantId,
    batchId,
    domain: "math" as const,
    task: "2 + 2",
    rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
    modelOutput: "4",
    grade: { score: 10, maxScore: 10, reasoning: "Correct" },
    graderId: `grader-${runId}`,
    createdAt: new Date(),
  });
  await prisma.workUnit.create({ data: unitData(flaggedUnitId) });
  await prisma.workUnit.create({ data: unitData(clearUnitId) });

  // One unit flagged for regrade (risk above the 0.4 threshold), one clear — mirrors what
  // processSignals.ts writes before ever queuing a regrade job.
  await prisma.verdict.create({
    data: { tenantId, workUnitId: flaggedUnitId, risk: 0.5, recommendation: "re_review" },
  });
  await prisma.verdict.create({
    data: { tenantId, workUnitId: clearUnitId, risk: 0.1, recommendation: "clear" },
  });
});

afterAll(async () => {
  await prisma.verdict.deleteMany({ where: { workUnitId: { in: [flaggedUnitId, clearUnitId] } } });
  await prisma.signal.deleteMany({ where: { workUnitId: { in: [flaggedUnitId, clearUnitId] } } });
  await prisma.workUnit.deleteMany({ where: { id: { in: [flaggedUnitId, clearUnitId] } } });
  await prisma.batch.deleteMany({ where: { id: batchId } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("refreshBatchProgress", () => {
  it("does not mark the batch done while a flagged item's regrade is still outstanding, and publishes the live snapshot", async () => {
    const channel = `quorum:batch:${batchId}`;
    const [progress, published] = await Promise.all([
      refreshBatchProgress(prisma, redis, batchId),
      waitForMessage(channel),
    ]);

    expect(progress.batchStatus).toBe("pending");
    expect(progress.flaggedForRegrade).toBe(1);
    expect(progress.regradeQueued).toBe(1);
    expect(progress.regradeDone).toBe(0);

    const parsed = JSON.parse(published);
    expect(parsed.type).toBe("batch_progress");
    expect(parsed.batchStatus).toBe("pending");

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("pending");
  });

  it("marks the batch done once every flagged item has a regrade signal, matching what regradeWorker writes on completion", async () => {
    await prisma.signal.create({
      data: {
        tenantId,
        workUnitId: flaggedUnitId,
        key: "regrade",
        fired: false,
        weight: 0.5,
        evidence: "Agent regrade agreed with the human grade",
      },
    });

    const progress = await refreshBatchProgress(prisma, redis, batchId);

    expect(progress.regradeQueued).toBe(0);
    expect(progress.regradeDone).toBe(1);
    expect(progress.batchStatus).toBe("done");

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("done");
  });
});

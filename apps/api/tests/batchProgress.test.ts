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

// Subscribes and resolves once the subscription is actually registered with Redis, returning
// a promise for the next message. Callers must await the returned `ready` before triggering
// whatever will publish — otherwise the publish can race ahead of `sub.subscribe()`'s network
// round-trip and the message is missed, timing out for reasons unrelated to the code under test.
function subscribeTo(channel: string, timeoutMs = 5000): { ready: Promise<void>; next: Promise<string>; close: () => Promise<void> } {
  const sub = redis.duplicate();
  let resolveMessage: (message: string) => void;
  let rejectMessage: (err: Error) => void;
  const next = new Promise<string>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
  });
  sub.on("message", (_ch, message) => {
    clearTimeout(timer);
    resolveMessage(message);
  });
  const timer = setTimeout(() => rejectMessage(new Error("Timed out waiting for a pub/sub message")), timeoutMs);
  const ready = sub.subscribe(channel).then(() => undefined);
  const close = async () => {
    clearTimeout(timer);
    await sub.unsubscribe(channel).catch(() => {});
    await sub.quit().catch(() => {});
  };
  return { ready, next, close };
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
    const sub = subscribeTo(channel);
    await sub.ready;
    try {
      const [progress, published] = await Promise.all([refreshBatchProgress(prisma, redis, batchId), sub.next]);

      expect(progress.batchStatus).toBe("pending");
      expect(progress.flaggedForRegrade).toBe(1);
      expect(progress.regradeQueued).toBe(1);
      expect(progress.regradeDone).toBe(0);

      const parsed = JSON.parse(published);
      expect(parsed.type).toBe("batch_progress");
      expect(parsed.batchStatus).toBe("pending");

      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.status).toBe("pending");
    } finally {
      await sub.close();
    }
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

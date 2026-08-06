import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import type { BatchProgressEvent, QuorumLiveEvent } from "@quorum/schema";
import { getCurrentRegradeJob } from "../workers/regradeWorker.js";

export function publishEvent(redis: Redis, batchId: string, event: QuorumLiveEvent): Promise<number> {
  return redis.publish(`quorum:batch:${batchId}`, JSON.stringify(event));
}

export async function computeBatchProgress(prisma: PrismaClient, batchId: string): Promise<BatchProgressEvent> {
  const [batch, totalUnits, scoredUnits, flaggedForRegrade, regradeDone] = await Promise.all([
    prisma.batch.findUniqueOrThrow({ where: { id: batchId } }),
    prisma.workUnit.count({ where: { batchId } }),
    prisma.verdict.count({ where: { workUnit: { batchId } } }),
    prisma.verdict.count({ where: { workUnit: { batchId }, risk: { gte: 0.4 } } }),
    prisma.signal.count({ where: { key: "regrade", workUnit: { batchId } } }),
  ]);

  const currentJob = getCurrentRegradeJob();
  const regradeProcessing = currentJob?.batchId === batchId ? 1 : 0;
  const regradeQueued = Math.max(0, flaggedForRegrade - regradeDone - regradeProcessing);

  return {
    type: "batch_progress",
    batchId,
    totalUnits,
    scoredUnits,
    flaggedForRegrade,
    regradeQueued,
    regradeProcessing,
    regradeDone,
    batchStatus: batch.status as "pending" | "processing" | "done",
  };
}

// Recomputes a batch's progress, persists status "done" once every unit is scored and no
// regrade is queued or in flight, and republishes the fresh snapshot so any connected SSE
// client's stats and completion banner update in real time (not just once, at ingest time).
export async function refreshBatchProgress(
  prisma: PrismaClient,
  redis: Redis,
  batchId: string
): Promise<BatchProgressEvent> {
  const progress = await computeBatchProgress(prisma, batchId);
  const trulyDone =
    progress.scoredUnits === progress.totalUnits &&
    progress.regradeQueued === 0 &&
    progress.regradeProcessing === 0;

  if (trulyDone && progress.batchStatus !== "done") {
    await prisma.batch.update({ where: { id: batchId }, data: { status: "done" } });
    progress.batchStatus = "done";
  }

  await publishEvent(redis, batchId, progress);
  return progress;
}

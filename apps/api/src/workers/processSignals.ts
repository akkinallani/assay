import { Worker, Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { WorkUnit } from "@quorum/schema";
import {
  consistencySignal,
  coverageSignal,
  cohortSignal,
  computeCohortStats,
  buildVerdict,
} from "@quorum/engine";
import type { BatchContext } from "@quorum/engine";
import type { Redis } from "ioredis";
import { refreshBatchProgress } from "../events/bus.js";
import { checkConsistencyWithLLM } from "../llm/tools/consistencyCheck.js";

export const signalQueue = (redis: Redis) =>
  new Queue("process-signals", { connection: redis });

export const regradeQueueName = "regrade";

// Bounded so ingest time doesn't scale with batch size — the heuristic (free, instant) stays
// the primary signal; this is a small LLM-backed spot-check over items the heuristic passed,
// not a replacement. See PROD comment in packages/engine/src/signals/consistency.ts.
const CONSISTENCY_SPOT_CHECK_CAP = 5;

function sampleUpTo<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function createSignalWorker(prisma: PrismaClient, redis: Redis, regradeQueue: Queue) {
  return new Worker(
    "process-signals",
    async (job) => {
      const { batchId, tenantId } = job.data as { batchId: string; tenantId: string };

      const dbUnits = await prisma.workUnit.findMany({
        where: { batchId, tenantId },
      });

      const units = dbUnits.map((u) => ({
        ...u,
        rubric: u.rubric as unknown as WorkUnit["rubric"],
        grade: u.grade as unknown as WorkUnit["grade"],
        attachments: u.attachments as unknown as WorkUnit["attachments"],
        domain: u.domain as WorkUnit["domain"],
        createdAt: u.createdAt.toISOString(),
      })) as WorkUnit[];

      const cohortStats = computeCohortStats(units);
      const ctx: BatchContext = { batchId, cohortStats };
      const consistencyClearUnits: WorkUnit[] = [];
      // A unit already queued for regrade below (from its heuristic signals) must not be queued
      // again if the LLM spot-check loop later flips its consistency signal too — regradeWorker
      // has no dedup of its own (it always creates a fresh "regrade" signal row per job), so two
      // jobs for the same unit would double the LLM cost and double-count the "regrade" signal's
      // weight in the final risk score.
      const queuedForRegrade = new Set<string>();

      for (const unit of units) {
        const signals = [
          consistencySignal(unit, ctx),
          coverageSignal(unit, ctx),
          cohortSignal(unit, ctx),
        ];

        if (!signals[0].fired) {
          consistencyClearUnits.push(unit);
        }

        const verdict = buildVerdict(unit.id, signals);

        await prisma.$transaction([
          prisma.signal.deleteMany({ where: { workUnitId: unit.id } }),
          prisma.signal.createMany({
            data: signals.map((s) => ({
              tenantId: unit.tenantId,
              workUnitId: unit.id,
              key: s.key,
              fired: s.fired,
              weight: s.weight,
              evidence: s.evidence,
              detail: s.detail ? (s.detail as object) : undefined,
            })),
          }),
          prisma.verdict.upsert({
            where: { workUnitId: unit.id },
            create: {
              tenantId: unit.tenantId,
              workUnitId: unit.id,
              risk: verdict.risk,
              recommendation: verdict.recommendation,
            },
            update: {
              risk: verdict.risk,
              recommendation: verdict.recommendation,
            },
          }),
        ]);

        const anyFired = signals.some((s) => s.fired);

        // Merge this item's domain into the grader's existing domainStats — the upsert's `create`
        // branch only fires once per grader, so any per-domain accumulation has to happen here,
        // not inside the upsert data itself.
        const priorStat = await prisma.graderStat.findUnique({
          where: { tenantId_graderId: { tenantId: unit.tenantId, graderId: unit.graderId } },
          select: { domainStats: true },
        });
        const existingDomainStats =
          (priorStat?.domainStats as Record<string, { itemsSeen: number; flagCount: number }> | null) ?? {};
        const priorDomainStat = existingDomainStats[unit.domain] ?? { itemsSeen: 0, flagCount: 0 };
        const nextDomainStats = {
          ...existingDomainStats,
          [unit.domain]: {
            itemsSeen: priorDomainStat.itemsSeen + 1,
            flagCount: priorDomainStat.flagCount + (anyFired ? 1 : 0),
          },
        };

        await prisma.graderStat.upsert({
          where: { tenantId_graderId: { tenantId: unit.tenantId, graderId: unit.graderId } },
          create: {
            tenantId: unit.tenantId,
            graderId: unit.graderId,
            itemsSeen: 1,
            flagCount: anyFired ? 1 : 0,
            domainStats: nextDomainStats,
          },
          update: {
            itemsSeen: { increment: 1 },
            flagCount: { increment: anyFired ? 1 : 0 },
            domainStats: nextDomainStats,
          },
        });

        if (verdict.risk >= 0.4) {
          await regradeQueue.add("regrade-item", { workUnitId: unit.id, batchId }, { attempts: 3 });
          queuedForRegrade.add(unit.id);
        }
      }

      const spotCheckCandidates = sampleUpTo(consistencyClearUnits, CONSISTENCY_SPOT_CHECK_CAP);
      for (const unit of spotCheckCandidates) {
        // This spot-check is a supplementary audit on top of the free heuristic (see the cap
        // comment above), not a required step — a connection failure or other non-parse error
        // reaching the LLM backend here must not abort the whole batch (and everything after
        // it: the remaining spot-check candidates, and — before refreshBatchProgress existed
        // to run unconditionally — leave status stuck "pending" forever). Skip and move on.
        const audit = await checkConsistencyWithLLM(unit, batchId).catch((err) => {
          console.warn(`Consistency spot-check failed for work unit ${unit.id}, skipping:`, err);
          return null;
        });
        if (!audit || audit.consistent) continue;

        const existingSignals = await prisma.signal.findMany({ where: { workUnitId: unit.id } });
        const otherSignals = existingSignals
          .filter((s) => s.key !== "consistency")
          .map((s) => ({
            key: s.key as "consistency" | "coverage" | "cohort" | "regrade",
            fired: s.fired,
            weight: s.weight,
            evidence: s.evidence,
            detail: s.detail as unknown,
          }));
        const updatedConsistency = {
          key: "consistency" as const,
          fired: true,
          weight: 0.5,
          evidence: `LLM audit: ${audit.evidence}`,
        };
        const updatedVerdict = buildVerdict(unit.id, [updatedConsistency, ...otherSignals]);

        await prisma.$transaction([
          prisma.signal.updateMany({
            where: { workUnitId: unit.id, key: "consistency" },
            data: { fired: true, evidence: updatedConsistency.evidence },
          }),
          prisma.verdict.update({
            where: { workUnitId: unit.id },
            data: { risk: updatedVerdict.risk, recommendation: updatedVerdict.recommendation },
          }),
        ]);

        if (updatedVerdict.risk >= 0.4 && !queuedForRegrade.has(unit.id)) {
          await regradeQueue.add("regrade-item", { workUnitId: unit.id, batchId }, { attempts: 3 });
          queuedForRegrade.add(unit.id);
        }
      }

      // Only actually flips status to "done" if nothing was flagged for regrade — a batch
      // with flagged items stays "pending" until regradeWorker's completions catch it up.
      await refreshBatchProgress(prisma, redis, batchId);
    },
    { connection: redis, concurrency: 2 }
  );
}

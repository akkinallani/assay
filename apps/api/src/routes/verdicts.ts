import type { FastifyPluginAsync } from "fastify";
import { resolveVerdictSchema } from "@quorum/schema";
import { badRequest, conflict, notFound } from "../errors.js";

function serialize(verdict: {
  id: string;
  workUnitId: string;
  risk: number;
  recommendation: string;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  resolutionOutcome: string | null;
  resolvedBy: { email: string } | null;
}) {
  return {
    id: verdict.id,
    workUnitId: verdict.workUnitId,
    risk: verdict.risk,
    recommendation: verdict.recommendation,
    resolvedAt: verdict.resolvedAt,
    resolvedByEmail: verdict.resolvedBy?.email ?? null,
    resolutionNote: verdict.resolutionNote,
    resolutionOutcome: verdict.resolutionOutcome,
  };
}

// tenantId is repeated at each nested relation level (not just the top-level Signal filter it's
// already implied by) so Postgres can push it into the WorkUnit/Verdict joins directly —
// without it, Prisma's generated SQL leaves those two joins fully unconstrained and Postgres has
// no way to avoid a full scan of both tables, system-wide across every tenant, on this page's
// every load. Verified directly via EXPLAIN ANALYZE against realistic multi-tenant data: adding
// it turns two Seq Scans into tenantId-index scans, cutting execution time roughly in half at
// just 40k rows, with the gap growing as the platform's total row count grows (identical result
// set either way). Exported so its query plan can be tested directly against the real shape this
// route sends, not a hand-copied approximation of it.
export function firedSignalsWhere(tenantId: string) {
  return {
    tenantId,
    fired: true,
    workUnit: { tenantId, verdict: { tenantId, resolutionOutcome: { not: null } } },
  };
}

// Confirmed/false-positive counts -> precision, guarding divide-by-zero with null (not 0) so the
// UI can tell "not enough data yet" apart from "measured 0% precision".
function accuracyStats(outcomes: string[]) {
  const confirmedCount = outcomes.filter((o) => o === "confirmed_issue").length;
  const falsePositiveCount = outcomes.filter((o) => o === "false_positive").length;
  const total = confirmedCount + falsePositiveCount;
  return { confirmedCount, falsePositiveCount, precision: total > 0 ? confirmedCount / total : null };
}

const verdictsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/verdicts/:verdictId/resolve", async (request) => {
    const { verdictId } = request.params as { verdictId: string };
    const parsed = resolveVerdictSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("validation_failed", "Validation failed", parsed.error.issues);
    }

    const existing = await fastify.prisma.verdict.findFirst({
      where: { id: verdictId, tenantId: request.tenantId },
    });
    if (!existing) throw notFound("verdict_not_found");

    // Scoped to the still-unresolved case so two concurrent resolves (e.g. two reviewers) can't
    // both pass a read-then-write check and silently clobber each other's outcome.
    const { count } = await fastify.prisma.verdict.updateMany({
      where: { id: verdictId, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: request.userId,
        resolutionNote: parsed.data.note ?? null,
        resolutionOutcome: parsed.data.outcome,
      },
    });
    if (count === 0) {
      throw conflict("already_resolved", "This item was already resolved. Reopen it first to change the outcome.");
    }

    const updated = await fastify.prisma.verdict.findUniqueOrThrow({
      where: { id: verdictId },
      include: { resolvedBy: { select: { email: true } } },
    });

    return serialize(updated);
  });

  fastify.post("/verdicts/:verdictId/reopen", async (request) => {
    const { verdictId } = request.params as { verdictId: string };

    const existing = await fastify.prisma.verdict.findFirst({
      where: { id: verdictId, tenantId: request.tenantId },
    });
    if (!existing) throw notFound("verdict_not_found");

    const updated = await fastify.prisma.verdict.update({
      where: { id: verdictId },
      data: { resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionOutcome: null },
      include: { resolvedBy: { select: { email: true } } },
    });

    return serialize(updated);
  });

  fastify.get("/accuracy", async (request) => {
    const tenantId = request.tenantId;

    const resolvedFlagged = await fastify.prisma.verdict.findMany({
      where: { tenantId, resolutionOutcome: { not: null }, recommendation: { not: "clear" } },
      select: { resolutionOutcome: true },
    });
    const overallStats = accuracyStats(resolvedFlagged.map((v) => v.resolutionOutcome as string));

    const firedSignals = await fastify.prisma.signal.findMany({
      where: firedSignalsWhere(tenantId),
      select: {
        key: true,
        createdAt: true,
        workUnit: { select: { verdict: { select: { resolutionOutcome: true, resolvedAt: true } } } },
      },
    });

    const bySignalOutcomes = new Map<string, string[]>();
    for (const s of firedSignals) {
      const verdict = s.workUnit.verdict;
      const outcome = verdict?.resolutionOutcome;
      if (!outcome) continue;
      // A signal that fired *after* the verdict was resolved (e.g. a regrade or spot-check that
      // completes after a human has already judged the flag) wasn't part of what that judgment
      // evaluated — counting it here would attribute the outcome to a signal the human never saw.
      if (verdict.resolvedAt && s.createdAt > verdict.resolvedAt) continue;
      if (!bySignalOutcomes.has(s.key)) bySignalOutcomes.set(s.key, []);
      bySignalOutcomes.get(s.key)!.push(outcome);
    }

    const bySignal = Array.from(bySignalOutcomes.entries()).map(([key, outcomes]) => {
      const stats = accuracyStats(outcomes);
      return { key, firedCount: outcomes.length, ...stats };
    });

    return {
      overall: { resolvedCount: resolvedFlagged.length, ...overallStats },
      bySignal,
    };
  });
};

export default verdictsRoutes;

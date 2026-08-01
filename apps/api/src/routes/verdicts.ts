import type { FastifyPluginAsync } from "fastify";
import { resolveVerdictSchema } from "@quorum/schema";
import { badRequest, notFound } from "../errors.js";

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

    const updated = await fastify.prisma.verdict.update({
      where: { id: verdictId },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: request.userId,
        resolutionNote: parsed.data.note ?? null,
        resolutionOutcome: parsed.data.outcome,
      },
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
      where: { tenantId, fired: true, workUnit: { verdict: { resolutionOutcome: { not: null } } } },
      select: { key: true, workUnit: { select: { verdict: { select: { resolutionOutcome: true } } } } },
    });

    const bySignalOutcomes = new Map<string, string[]>();
    for (const s of firedSignals) {
      const outcome = s.workUnit.verdict?.resolutionOutcome;
      if (!outcome) continue;
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

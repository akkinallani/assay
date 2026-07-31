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
  };
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
      data: { resolvedAt: null, resolvedByUserId: null, resolutionNote: null },
      include: { resolvedBy: { select: { email: true } } },
    });

    return serialize(updated);
  });
};

export default verdictsRoutes;

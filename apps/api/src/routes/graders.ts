import type { FastifyPluginAsync } from "fastify";

const graderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/graders", async (request) => {
    const tenantId = request.tenantId;
    const stats = await fastify.prisma.graderStat.findMany({ where: { tenantId } });
    return stats.map((s) => ({
      graderId: s.graderId,
      itemsSeen: s.itemsSeen,
      flagRate: s.itemsSeen > 0 ? s.flagCount / s.itemsSeen : 0,
      agreementWithRegrade: s.regradeCount > 0 ? s.agreementCount / s.regradeCount : 1,
      domainBreakdown: s.domainStats,
    }));
  });
};

export default graderRoutes;

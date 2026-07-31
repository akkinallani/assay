import type { FastifyPluginAsync } from "fastify";

const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    return { status: "ok", version: "0.1.0" };
  });
};

export default healthRoute;

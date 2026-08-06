import type { FastifyPluginAsync } from "fastify";
import type { Redis } from "ioredis";
import { computeBatchProgress } from "../events/bus.js";
import { notFound } from "../errors.js";

export default function liveEventsRoutes(redis: Redis): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get("/batches/:batchId/live", async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      const tenantId = request.tenantId;

      const batch = await fastify.prisma.batch.findFirst({ where: { id: batchId, tenantId } });
      if (!batch) throw notFound("batch_not_found");

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sub = redis.duplicate();
      const channel = `quorum:batch:${batchId}`;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      // Registered before any of the awaited setup below, which can itself throw (a Redis or
      // DB blip) — once the reply is hijacked, Fastify's own error handler can no longer send
      // a response, so without this the duplicated Redis connection below would leak forever
      // and the client would be left holding an open connection that never receives data.
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        sub.unsubscribe(channel).catch(() => {});
        sub.quit().catch(() => {});
      };
      request.raw.on("close", cleanup);

      try {
        await sub.subscribe(channel);
        sub.on("message", (_channel, message) => {
          reply.raw.write(`data: ${message}\n\n`);
        });

        const snapshot = await computeBatchProgress(fastify.prisma, batchId);
        reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

        heartbeat = setInterval(() => {
          reply.raw.write(":\n\n");
        }, 15000);
      } catch (err) {
        request.log.error(err, "live SSE stream setup failed");
        cleanup();
        reply.raw.end();
      }
    });
  };
}

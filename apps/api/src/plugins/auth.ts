import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { SESSION_COOKIE } from "../lib/session.js";
import { unauthorized } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
  }
}

const PUBLIC_ROUTES = new Set(["/health", "/auth/signup", "/auth/login"]);

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    if (PUBLIC_ROUTES.has(request.url.split("?")[0])) return;

    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) throw unauthorized();

    const unsigned = fastify.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) throw unauthorized();

    const session = await fastify.prisma.session.findUnique({
      where: { id: unsigned.value },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) throw unauthorized();

    request.userId = session.user.id;
    request.tenantId = session.user.tenantId;
  });
});

export default authPlugin;

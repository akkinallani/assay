import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { SESSION_COOKIE } from "../lib/session.js";
import { unauthorized, forbidden } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
  }
}

// Matched against the route's registered pattern (e.g. "/invites/:token/accept"),
// not the literal request URL, so parameterized public routes work too.
export const PUBLIC_ROUTES = new Set([
  "/health",
  "/auth/signup",
  "/auth/login",
  "/auth/google",
  "/auth/google/callback",
  "/invites/:token/accept",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    // Defense-in-depth CSRF check: a cross-site form/fetch can't set custom
    // headers, so this blocks state-changing requests that didn't come from
    // our own client code, on top of the SameSite=Lax cookie protection.
    if (!SAFE_METHODS.has(request.method) && request.headers["x-requested-with"] !== "quorum") {
      throw forbidden("csrf_check_failed", "Missing required header");
    }

    const routePattern = request.routeOptions?.url ?? request.url.split("?")[0];
    if (PUBLIC_ROUTES.has(routePattern)) return;

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

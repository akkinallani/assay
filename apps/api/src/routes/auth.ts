import type { FastifyPluginAsync } from "fastify";
import type { Redis } from "ioredis";
import bcrypt from "bcryptjs";
import { loginSchema, signupSchema } from "@quorum/schema";
import { createSession, destroySession, setSessionCookie, SESSION_COOKIE } from "../lib/session.js";
import { badRequest, conflict, tooManyRequests, unauthorized } from "../errors.js";

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;
const loginFailKey = (email: string) => `login-fail:${email.toLowerCase()}`;

export default function authRoutes(redis: Redis): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post(
      "/auth/signup",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const parsed = signupSchema.safeParse(request.body);
        if (!parsed.success) {
          throw badRequest("validation_failed", "Validation failed", parsed.error.issues);
        }
        const { email, password, tenantName } = parsed.data;

        const existing = await fastify.prisma.user.findUnique({ where: { email } });
        if (existing) throw conflict("email_taken", "An account with that email already exists");

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await fastify.prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({ data: { name: tenantName } });
          return tx.user.create({
            data: { email, passwordHash, tenantId: tenant.id },
            include: { tenant: true },
          });
        });

        const session = await createSession(fastify.prisma, user.id);
        setSessionCookie(reply, session.id);

        return reply
          .code(201)
          .send({ id: user.id, email: user.email, tenantId: user.tenantId, tenantName: user.tenant.name });
      }
    );

    fastify.post(
      "/auth/login",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
          throw badRequest("validation_failed", "Validation failed", parsed.error.issues);
        }
        const { email, password } = parsed.data;

        const failKey = loginFailKey(email);
        const failCount = parseInt((await redis.get(failKey)) ?? "0", 10);
        if (failCount >= LOGIN_FAIL_LIMIT) {
          throw tooManyRequests("too_many_attempts", "Too many failed login attempts. Try again later.");
        }

        const user = await fastify.prisma.user.findUnique({ where: { email }, include: { tenant: true } });
        if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
          await redis
            .multi()
            .incr(failKey)
            .expire(failKey, LOGIN_FAIL_WINDOW_SECONDS)
            .exec();
          if (user && !user.passwordHash) {
            throw unauthorized("This account uses Google sign-in — use the Google button instead");
          }
          throw unauthorized("Invalid email or password");
        }

        await redis.del(failKey);

        const session = await createSession(fastify.prisma, user.id);
        setSessionCookie(reply, session.id);

        return reply.send({ id: user.id, email: user.email, tenantId: user.tenantId, tenantName: user.tenant.name });
      }
    );

    fastify.post("/auth/logout", async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE];
      if (raw) {
        const unsigned = fastify.unsignCookie(raw);
        if (unsigned.valid && unsigned.value) {
          await destroySession(fastify.prisma, unsigned.value);
        }
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.send({ ok: true });
    });

    fastify.get("/auth/me", async (request) => {
      const user = await fastify.prisma.user.findUniqueOrThrow({
        where: { id: request.userId },
        include: { tenant: true },
      });
      return { id: user.id, email: user.email, tenantId: user.tenantId, tenantName: user.tenant.name };
    });
  };
}

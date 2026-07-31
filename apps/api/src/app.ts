import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import healthRoute from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import googleOAuthPlugin from "./plugins/googleOAuth.js";
import invitesRoutes from "./routes/invites.js";
import batchRoutes from "./routes/batches.js";
import graderRoutes from "./routes/graders.js";
import liveEventsRoutes from "./routes/liveEvents.js";
import type { Redis } from "ioredis";
import { ApiError } from "./errors.js";

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function buildApp(redis: Redis) {
  const fastify = Fastify({ logger: true });

  fastify.register(cors, { origin: corsOrigins, credentials: true });
  fastify.register(cookie, { secret: process.env.COOKIE_SECRET ?? "dev-only-insecure-secret" });
  fastify.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });

  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, issues: err.issues });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return reply.code(409).send({ error: "conflict", message: "Resource already exists" });
    }
    if (err.validation) {
      return reply.code(400).send({ error: "validation_failed", message: err.message });
    }
    request.log.error(err);
    return reply.code(500).send({ error: "internal_error", message: "Something went wrong" });
  });

  fastify.register(prismaPlugin);
  fastify.register(authPlugin);
  fastify.register(healthRoute);
  fastify.register(authRoutes(redis));
  fastify.register(googleOAuthPlugin);
  fastify.register(invitesRoutes);
  fastify.register(batchRoutes(redis));
  fastify.register(graderRoutes);
  fastify.register(liveEventsRoutes(redis));

  return fastify;
}

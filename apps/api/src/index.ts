import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { createSignalWorker, signalQueue } from "./workers/processSignals.js";
import { createRegradeWorker, regradeQueue } from "./workers/regradeWorker.js";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production" && !process.env.COOKIE_SECRET) {
  console.error("COOKIE_SECRET must be set in production — refusing to start with an insecure default.");
  process.exit(1);
}

const port = parseInt(process.env.PORT ?? "3000", 10);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const signalQ = signalQueue(redis);
const regradeQ = regradeQueue(redis);

createSignalWorker(prisma, redis, regradeQ);
createRegradeWorker(prisma, redis);

const app = buildApp(redis);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

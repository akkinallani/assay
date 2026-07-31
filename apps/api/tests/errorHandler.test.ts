import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const app = buildApp(redis);

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

describe("global error handler", () => {
  it("returns a 400, not a 500, for Fastify's own framework-level errors (e.g. empty JSON body)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-requested-with": "quorum", "content-type": "application/json" },
      // No payload at all, with a JSON content-type — triggers Fastify's own
      // FST_ERR_CTP_EMPTY_JSON_BODY before our route code ever runs.
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";

const CSRF_HEADERS = { "x-requested-with": "quorum" };

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

// The response can end server-side without the underlying keep-alive socket actually closing,
// so "end" (the response body finished) is the right signal here, not "close".
function waitForResponseEnd(res: http.IncomingMessage, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    res.on("data", () => {});
    res.on("end", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("GET /batches/:id/live — setup failure cleanup", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  const app = buildApp(redis);
  const runId = Math.random().toString(36).slice(2);
  const email = `live-setup-fail-${runId}@example.com`;
  const password = "correct horse battery staple";
  let cookie: string;
  let batchId: string;
  let port: number;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it("closes the connection and doesn't leak the duplicated redis connection when the subscribe fails", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email, password, tenantName: `Live Setup Fail Tenant ${runId}` },
    });
    cookie = sessionCookieFrom(signup);

    const created = await app.inject({
      method: "POST",
      url: "/batches",
      headers: { cookie, ...CSRF_HEADERS },
      payload: [
        {
          id: `live-setup-fail-unit-${runId}`,
          tenantId: "ignored",
          batchId: "ignored",
          domain: "math",
          task: "2 + 2",
          rubric: [{ id: "r1", text: "Correct", required: true, weight: 1 }],
          modelOutput: "4",
          grade: { score: 10, maxScore: 10, reasoning: "Correct" },
          graderId: "grader-1",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    batchId = created.json().batchId;

    // Simulates a transient Redis blip on the duplicated pub/sub connection's SUBSCRIBE call,
    // which happens after reply.hijack() + writeHead(200) have already run.
    vi.spyOn(Redis.prototype, "subscribe").mockRejectedValueOnce(new Error("connection lost"));
    const quitSpy = vi.spyOn(Redis.prototype, "quit");

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        { port, host: "127.0.0.1", path: `/batches/${batchId}/live`, headers: { cookie } },
        resolve
      );
      req.on("error", reject);
      req.end();
    });

    try {
      // Before the fix, a setup failure after hijack() left the connection open forever with
      // no data and no end — the client would hang here indefinitely. The fix ends the raw
      // response on failure, so the response should end promptly instead.
      const ended = await waitForResponseEnd(res, 5000);
      expect(ended).toBe(true);

      // The duplicated Redis connection created for this request must not be left dangling —
      // it should be explicitly quit as part of the failure cleanup.
      expect(quitSpy).toHaveBeenCalled();
    } finally {
      res.destroy();
    }
  }, 10000);
});

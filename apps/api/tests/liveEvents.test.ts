import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const CSRF_HEADERS = { "x-requested-with": "quorum" };
const runId = Math.random().toString(36).slice(2);
const emailA = `live-test-a-${runId}@example.com`;
const emailB = `live-test-b-${runId}@example.com`;
const password = "correct-horse-battery";

let cookieA: string;
let cookieB: string;
let batchId: string;

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

beforeAll(async () => {
  await app.ready();

  const signupA = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: emailA, password, tenantName: `Live Tenant A ${runId}` },
  });
  cookieA = sessionCookieFrom(signupA);

  const signupB = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: emailB, password, tenantName: `Live Tenant B ${runId}` },
  });
  cookieB = sessionCookieFrom(signupB);

  const created = await app.inject({
    method: "POST",
    url: "/batches",
    headers: { cookie: cookieA, ...CSRF_HEADERS },
    payload: [
      {
        id: `live-unit-${runId}`,
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
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Live Tenant A ${runId}`, `Live Tenant B ${runId}`] } },
  });
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  // Not deleting the batch/work unit — same reasoning as auth.test.ts: a live
  // worker may be processing it asynchronously.
});

describe("liveEvents ownership check", () => {
  it("404s for a nonexistent batch", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/batches/does-not-exist/live",
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s when the batch belongs to another tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/batches/${batchId}/live`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(404);
  });
});

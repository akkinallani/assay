import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const CSRF_HEADERS = { "x-requested-with": "quorum" };
const runId = Math.random().toString(36).slice(2);
const emailA = `graders-test-a-${runId}@example.com`;
const emailB = `graders-test-b-${runId}@example.com`;
const password = "correct-horse-battery";
const graderId = `grader-${runId}`;

let tenantAId: string;
let cookieA: string;
let cookieB: string;

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
    payload: { email: emailA, password, tenantName: `Graders Tenant A ${runId}` },
  });
  cookieA = sessionCookieFrom(signupA);
  tenantAId = signupA.json().tenantId;

  const signupB = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: emailB, password, tenantName: `Graders Tenant B ${runId}` },
  });
  cookieB = sessionCookieFrom(signupB);

  await prisma.graderStat.create({
    data: {
      tenantId: tenantAId,
      graderId,
      itemsSeen: 10,
      flagCount: 3,
      agreementCount: 2,
      regradeCount: 4,
    },
  });
});

afterAll(async () => {
  await prisma.graderStat.deleteMany({ where: { tenantId: tenantAId } });
  await prisma.session.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Graders Tenant A ${runId}`, `Graders Tenant B ${runId}`] } },
  });
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe("graders", () => {
  it("returns tenant-scoped grader stats", async () => {
    const res = await app.inject({ method: "GET", url: "/graders", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats).toHaveLength(1);
    expect(stats[0].graderId).toBe(graderId);
    expect(stats[0].flagRate).toBeCloseTo(0.3);
    expect(stats[0].agreementWithRegrade).toBeCloseTo(0.5);
  });

  it("does not leak another tenant's grader stats", async () => {
    const res = await app.inject({ method: "GET", url: "/graders", headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

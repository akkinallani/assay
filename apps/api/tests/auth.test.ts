import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const runId = Math.random().toString(36).slice(2);
const emailA = `auth-test-a-${runId}@example.com`;
const emailB = `auth-test-b-${runId}@example.com`;
const emailLockout = `auth-test-lockout-${runId}@example.com`;
const emailCase = `auth-test-case-${runId}@example.com`;
const password = "correct-horse-battery";

// Every mutating request needs this — the API rejects non-GET requests
// without it as a CSRF defense-in-depth check (apps/api/src/plugins/auth.ts).
const CSRF_HEADERS = { "x-requested-with": "quorum" };

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: { in: [emailA, emailB, emailLockout, emailCase] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB, emailLockout, emailCase] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Tenant A ${runId}`, `Tenant B ${runId}`, `Tenant Lockout ${runId}`, `Tenant Case ${runId}`] } },
  });
  await redis.del(`login-fail:${emailLockout.toLowerCase()}`);
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

beforeAll(async () => {
  await app.ready();
});

describe("auth", () => {
  it("rejects requests with no session", async () => {
    const res = await app.inject({ method: "GET", url: "/batches" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects mutating requests missing the CSRF header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: emailA, password },
    });
    expect(res.statusCode).toBe(403);
  });

  it("signs up, sets a session cookie, and exposes /auth/me", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: emailA, password, tenantName: `Tenant A ${runId}` },
    });
    expect(signup.statusCode).toBe(201);
    const cookie = sessionCookieFrom(signup);

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(emailA);
  });

  it("rejects signup with a duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: emailA, password, tenantName: `Tenant A dup ${runId}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong password", async () => {
    // Uses a different case than the email was signed up with — also covers that login is
    // case-insensitive, without spending a separate call against the login rate limiter below.
    const good = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: CSRF_HEADERS,
      payload: { email: emailA.toUpperCase(), password },
    });
    expect(good.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: CSRF_HEADERS,
      payload: { email: emailA, password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("locks out after repeated failed logins", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: emailLockout, password, tenantName: `Tenant Lockout ${runId}` },
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: CSRF_HEADERS,
        payload: { email: emailLockout, password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    }

    const lockedOut = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: CSRF_HEADERS,
      payload: { email: emailLockout, password },
    });
    expect(lockedOut.statusCode).toBe(429);
  });

  it("normalizes email case at signup, so a different-case duplicate is rejected as taken", async () => {
    const mixedCaseEmail = emailCase.replace(/^./, (c) => c.toUpperCase());

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: mixedCaseEmail, password, tenantName: `Tenant Case ${runId}` },
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json().email).toBe(emailCase);

    const dupSignup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: emailCase.toUpperCase(), password, tenantName: `Tenant Case Dup ${runId}` },
    });
    expect(dupSignup.statusCode).toBe(409);
  });

  it("logs out and invalidates the session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: CSRF_HEADERS,
      payload: { email: emailA, password },
    });
    const cookie = sessionCookieFrom(login);

    const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie, ...CSRF_HEADERS } });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("isolates tenants — one tenant cannot see another tenant's batches", async () => {
    const signupA = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: CSRF_HEADERS,
      payload: { email: emailA, password },
    });
    const cookieA = sessionCookieFrom(signupA);

    const signupB = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email: emailB, password, tenantName: `Tenant B ${runId}` },
    });
    const cookieB = sessionCookieFrom(signupB);

    const created = await app.inject({
      method: "POST",
      url: "/batches",
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: [
        {
          id: `unit-${runId}`,
          tenantId: "ignored-client-cannot-set-this",
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
    expect(created.statusCode).toBe(201);
    const { batchId } = created.json() as { batchId: string };

    const asOwner = await app.inject({
      method: "GET",
      url: `/batches/${batchId}/verdict`,
      headers: { cookie: cookieA },
    });
    expect(asOwner.statusCode).toBe(200);

    const asOtherTenant = await app.inject({
      method: "GET",
      url: `/batches/${batchId}/verdict`,
      headers: { cookie: cookieB },
    });
    expect(asOtherTenant.statusCode).toBe(404);

    const listAsOtherTenant = await app.inject({ method: "GET", url: "/batches", headers: { cookie: cookieB } });
    expect(listAsOtherTenant.json()).toEqual([]);

    // Not cleaning up the batch/work unit here: creating it enqueues a real
    // signal-processing job that a live worker may pick up asynchronously,
    // so deleting it immediately would race that worker's writes. Leftover
    // rows are tagged with runId and harmless in a dev database.
  });
});

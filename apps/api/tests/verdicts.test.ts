import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const CSRF_HEADERS = { "x-requested-with": "quorum" };
const runId = Math.random().toString(36).slice(2);
const emailA = `verdict-test-a-${runId}@example.com`;
const emailB = `verdict-test-b-${runId}@example.com`;
const password = "correct-horse-battery";

let cookieA: string;
let cookieB: string;
let verdictId: string;
let batchId: string;
let workUnitId: string;

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
    payload: { email: emailA, password, tenantName: `Verdict Tenant A ${runId}` },
  });
  cookieA = sessionCookieFrom(signupA);
  const tenantIdA = signupA.json().tenantId as string;

  const signupB = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: emailB, password, tenantName: `Verdict Tenant B ${runId}` },
  });
  cookieB = sessionCookieFrom(signupB);

  batchId = `verdict-test-batch-${runId}`;
  workUnitId = `verdict-test-unit-${runId}`;
  await prisma.batch.create({ data: { id: batchId, tenantId: tenantIdA, status: "done" } });
  await prisma.workUnit.create({
    data: {
      id: workUnitId,
      tenantId: tenantIdA,
      batchId,
      domain: "general",
      task: "task",
      rubric: [{ id: "r1", text: "criterion", required: true }],
      modelOutput: "output",
      grade: { score: 1, maxScore: 10, reasoning: "reasoning" },
      graderId: "grader-1",
      createdAt: new Date(),
    },
  });
  const verdict = await prisma.verdict.create({
    data: { tenantId: tenantIdA, workUnitId, risk: 0.9, recommendation: "re_review" },
  });
  verdictId = verdict.id;
});

afterAll(async () => {
  await prisma.verdict.deleteMany({ where: { workUnitId } });
  await prisma.workUnit.deleteMany({ where: { id: workUnitId } });
  await prisma.batch.deleteMany({ where: { id: batchId } });
  await prisma.session.deleteMany({ where: { user: { email: { in: [emailA, emailB] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Verdict Tenant A ${runId}`, `Verdict Tenant B ${runId}`] } },
  });
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe("verdict resolution", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: CSRF_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s when another tenant tries to resolve a verdict that isn't theirs", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: { cookie: cookieB, ...CSRF_HEADERS },
      payload: { outcome: "confirmed_issue", note: "not mine" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a resolve request with no outcome", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: { note: "missing outcome" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a resolve request with an invalid outcome", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: { outcome: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("resolves a verdict with a note and outcome, returning the resolver's email", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: {
        outcome: "confirmed_issue",
        note: "Confirmed the grade was too generous, coaching the grader.",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolvedAt).toBeTruthy();
    expect(body.resolvedByEmail).toBe(emailA);
    expect(body.resolutionNote).toBe("Confirmed the grade was too generous, coaching the grader.");
    expect(body.resolutionOutcome).toBe("confirmed_issue");

    const stored = await prisma.verdict.findUniqueOrThrow({ where: { id: verdictId } });
    expect(stored.resolvedAt).not.toBeNull();
    expect(stored.resolvedByUserId).toBeTruthy();
    expect(stored.resolutionOutcome).toBe("confirmed_issue");
  });

  it("409s resolving an already-resolved verdict, leaving the original resolution untouched", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/resolve`,
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: { outcome: "false_positive", note: "a second reviewer's overwrite attempt" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_resolved");

    const stored = await prisma.verdict.findUniqueOrThrow({ where: { id: verdictId } });
    expect(stored.resolutionOutcome).toBe("confirmed_issue");
    expect(stored.resolutionNote).toBe("Confirmed the grade was too generous, coaching the grader.");
  });

  it("reopens a resolved verdict, clearing all resolution fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/verdicts/${verdictId}/reopen`,
      headers: { cookie: cookieA, ...CSRF_HEADERS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolvedAt).toBeNull();
    expect(body.resolvedByEmail).toBeNull();
    expect(body.resolutionNote).toBeNull();
    expect(body.resolutionOutcome).toBeNull();

    const stored = await prisma.verdict.findUniqueOrThrow({ where: { id: verdictId } });
    expect(stored.resolvedAt).toBeNull();
    expect(stored.resolvedByUserId).toBeNull();
    expect(stored.resolutionNote).toBeNull();
    expect(stored.resolutionOutcome).toBeNull();
  });

  it("404s resolving a verdict id that doesn't exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verdicts/not-a-real-id/resolve",
      headers: { cookie: cookieA, ...CSRF_HEADERS },
      payload: { outcome: "confirmed_issue" },
    });
    expect(res.statusCode).toBe(404);
  });
});

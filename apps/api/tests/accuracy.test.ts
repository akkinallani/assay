import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const CSRF_HEADERS = { "x-requested-with": "quorum" };
const runId = Math.random().toString(36).slice(2);
const email = `accuracy-test-${runId}@example.com`;
const emptyEmail = `accuracy-test-empty-${runId}@example.com`;
const password = "correct-horse-battery";

let cookie: string;
let emptyCookie: string;
let batchId: string;
const workUnitIds: string[] = [];

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

function makeWorkUnit(tenantId: string, id: string) {
  return {
    id,
    tenantId,
    batchId,
    domain: "general",
    task: "task",
    rubric: [{ id: "r1", text: "criterion", required: true }],
    modelOutput: "output",
    grade: { score: 1, maxScore: 10, reasoning: "reasoning" },
    graderId: "grader-1",
    createdAt: new Date(),
  };
}

beforeAll(async () => {
  await app.ready();

  const signup = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email, password, tenantName: `Accuracy Tenant ${runId}` },
  });
  cookie = sessionCookieFrom(signup);
  const tenantId = signup.json().tenantId as string;

  const emptySignup = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: emptyEmail, password, tenantName: `Accuracy Empty Tenant ${runId}` },
  });
  emptyCookie = sessionCookieFrom(emptySignup);

  batchId = `accuracy-test-batch-${runId}`;
  await prisma.batch.create({ data: { id: batchId, tenantId, status: "done" } });

  // unit1: coverage fired, confirmed_issue
  // unit2: coverage fired, false_positive
  // unit3: cohort fired, confirmed_issue
  // unit4: coverage fired, recommendation "clear" (excluded), resolved anyway
  // unit5: no signal fired, flagged but unresolved (excluded)
  const specs = [
    { key: "u1", signalKey: "coverage", fired: true, recommendation: "re_review", outcome: "confirmed_issue" as const },
    { key: "u2", signalKey: "coverage", fired: true, recommendation: "re_review", outcome: "false_positive" as const },
    { key: "u3", signalKey: "cohort", fired: true, recommendation: "re_review", outcome: "confirmed_issue" as const },
    { key: "u4", signalKey: "coverage", fired: true, recommendation: "clear", outcome: "confirmed_issue" as const },
    { key: "u5", signalKey: "coverage", fired: false, recommendation: "re_review", outcome: null },
  ];

  for (const spec of specs) {
    const id = `accuracy-test-unit-${spec.key}-${runId}`;
    workUnitIds.push(id);
    await prisma.workUnit.create({ data: makeWorkUnit(tenantId, id) });
    await prisma.signal.create({
      data: {
        tenantId,
        workUnitId: id,
        key: spec.signalKey,
        fired: spec.fired,
        weight: 1,
        evidence: "evidence",
      },
    });
    const verdict = await prisma.verdict.create({
      data: { tenantId, workUnitId: id, risk: 0.9, recommendation: spec.recommendation },
    });
    if (spec.outcome) {
      await prisma.verdict.update({
        where: { id: verdict.id },
        data: { resolvedAt: new Date(), resolutionOutcome: spec.outcome },
      });
    }
  }
});

afterAll(async () => {
  await prisma.signal.deleteMany({ where: { workUnitId: { in: workUnitIds } } });
  await prisma.verdict.deleteMany({ where: { workUnitId: { in: workUnitIds } } });
  await prisma.workUnit.deleteMany({ where: { id: { in: workUnitIds } } });
  await prisma.batch.deleteMany({ where: { id: batchId } });
  await prisma.session.deleteMany({ where: { user: { email: { in: [email, emptyEmail] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [email, emptyEmail] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Accuracy Tenant ${runId}`, `Accuracy Empty Tenant ${runId}`] } },
  });
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe("GET /accuracy", () => {
  it("computes overall and per-signal precision from resolved, previously-flagged verdicts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/accuracy",
      headers: { cookie, ...CSRF_HEADERS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.overall).toEqual({
      resolvedCount: 3,
      confirmedCount: 2,
      falsePositiveCount: 1,
      precision: 2 / 3,
    });

    // The per-signal breakdown intentionally doesn't re-apply the recommendation != "clear" filter
    // that the overall metric uses, so u4 (coverage fired, recommendation "clear") still counts here.
    const bySignal = new Map(body.bySignal.map((s: { key: string }) => [s.key, s]));
    expect(bySignal.get("coverage")).toEqual({
      key: "coverage",
      firedCount: 3,
      confirmedCount: 2,
      falsePositiveCount: 1,
      precision: 2 / 3,
    });
    expect(bySignal.get("cohort")).toEqual({
      key: "cohort",
      firedCount: 1,
      confirmedCount: 1,
      falsePositiveCount: 0,
      precision: 1,
    });
  });

  it("returns null precision and an empty breakdown when nothing has been resolved yet", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/accuracy",
      headers: { cookie: emptyCookie, ...CSRF_HEADERS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.overall).toEqual({
      resolvedCount: 0,
      confirmedCount: 0,
      falsePositiveCount: 0,
      precision: null,
    });
    expect(body.bySignal).toEqual([]);
  });
});

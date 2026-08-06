import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { buildApp } from "../src/app.js";

const CSRF_HEADERS = { "x-requested-with": "quorum" };

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

describe("POST /batches — process-signals enqueue failure", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  const app = buildApp(redis);
  const runId = Math.random().toString(36).slice(2);
  const email = `enqueue-fail-test-${runId}@example.com`;
  const password = "correct horse battery staple";
  const unitId = `enqueue-fail-unit-${runId}`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  function payload() {
    return [
      {
        id: unitId,
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
    ];
  }

  it("cleans up the orphaned batch and lets the client safely retry the same upload", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email, password, tenantName: `Enqueue Fail Test Tenant ${runId}` },
    });
    const cookie = sessionCookieFrom(signup);
    const { tenantId } = signup.json() as { tenantId: string };

    // Simulate a transient Redis blip: the batch/work-unit transaction already committed by
    // the time queue.add() is called, so this is exactly the failure window the fix targets.
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(new Error("connection lost"));

    const failed = await app.inject({
      method: "POST",
      url: "/batches",
      headers: { cookie, ...CSRF_HEADERS },
      payload: payload(),
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ error: "batch_enqueue_failed" });

    // Before the fix, this batch (and its work unit) would still exist, permanently stuck
    // at "pending" with no signals ever computed and no way to retell it apart from a
    // slow-but-working batch.
    const orphanedBatches = await prisma.batch.findMany({ where: { tenantId } });
    expect(orphanedBatches).toHaveLength(0);
    const orphanedUnits = await prisma.workUnit.findMany({ where: { id: unitId } });
    expect(orphanedUnits).toHaveLength(0);

    // The client can now safely retry the exact same payload — no duplicate_work_unit_id
    // conflict, since nothing was left behind from the failed attempt.
    const retried = await app.inject({
      method: "POST",
      url: "/batches",
      headers: { cookie, ...CSRF_HEADERS },
      payload: payload(),
    });
    expect(retried.statusCode).toBe(201);

    // Not cleaning up this successful batch/work unit here for the same reason as
    // queueBackoff.test.ts — it enqueues a real job a live worker may pick up asynchronously.
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { createSignalWorker, signalQueue } from "../src/workers/processSignals.js";
import { regradeQueue } from "../src/workers/regradeWorker.js";

const CSRF_HEADERS = { "x-requested-with": "quorum" };

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

describe("POST /batches — enqueue job options", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  const app = buildApp(redis);
  const runId = Math.random().toString(36).slice(2);
  const email = `backoff-test-${runId}@example.com`;
  const password = "correct horse battery staple";

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it("enqueues the process-signals job with a retry backoff, not a bare zero-delay retry", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: CSRF_HEADERS,
      payload: { email, password, tenantName: `Backoff Test Tenant ${runId}` },
    });
    const cookie = sessionCookieFrom(signup);

    const created = await app.inject({
      method: "POST",
      url: "/batches",
      headers: { cookie, ...CSRF_HEADERS },
      payload: [
        {
          id: `backoff-unit-${runId}`,
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
    expect(created.statusCode).toBe(201);
    const { batchId } = created.json() as { batchId: string };

    const jobs = await signalQueue(redis).getJobs(["waiting", "active", "delayed"]);
    const job = jobs.find((j) => j.data.batchId === batchId);
    expect(job).toBeTruthy();
    // Before this fix, no `backoff` option was set at all, so BullMQ's default retries a
    // failed job immediately with zero delay — see the "with no backoff option" case in the
    // BullMQ-mechanics test below for what that actually does to retry timing.
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: "exponential", delay: 1000 });

    // Not cleaning up the batch/work unit here for the same reason as auth.test.ts: creating
    // it enqueues a real job a live worker may pick up asynchronously.
  });
});

describe("processSignals worker — regrade-item enqueue job options", () => {
  // Dedicated logical Redis db (see the comment in processSignals.test.ts) so this file's own
  // signal worker doesn't race another test file's worker over the same real Redis queue.
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null, db: 7 });
  const prisma = new PrismaClient();
  const runId = Math.random().toString(36).slice(2);
  const tenantId = `backoff-worker-tenant-${runId}`;
  const batchId = `backoff-worker-batch-${runId}`;
  const workUnitId = `backoff-worker-unit-${runId}`;

  let worker: ReturnType<typeof createSignalWorker>;

  beforeAll(async () => {
    await prisma.batch.create({ data: { id: batchId, tenantId, status: "pending" } });
    await prisma.workUnit.create({
      data: {
        id: workUnitId,
        tenantId,
        batchId,
        domain: "math",
        task: "2 + 2",
        rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
        modelOutput: "4",
        // Fires the heuristic consistency signal (weight 0.5 >= the 0.4 regrade threshold),
        // so this unit gets queued for regrade without needing a real LLM call.
        grade: { score: 9, maxScore: 10, reasoning: "This response is wrong and contains an error." },
        graderId: `grader-${runId}`,
        createdAt: new Date(),
      },
    });

    worker = createSignalWorker(prisma, redis, regradeQueue(redis));
    await worker.waitUntilReady();
    await signalQueue(redis).add("process-signals", { batchId, tenantId });
  });

  afterAll(async () => {
    await worker.close();
    await prisma.signal.deleteMany({ where: { workUnitId } });
    await prisma.verdict.deleteMany({ where: { workUnitId } });
    await prisma.workUnit.deleteMany({ where: { id: workUnitId } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.graderStat.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
    await redis.quit();
  });

  async function pollUntil<T>(fn: () => Promise<T | null>, timeoutMs = 10000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("Timed out waiting for worker to process the job");
  }

  it("enqueues the regrade-item job with a retry backoff", async () => {
    await pollUntil(() => prisma.verdict.findUnique({ where: { workUnitId } }));

    const jobs = await regradeQueue(redis).getJobs(["waiting", "active", "delayed", "completed", "failed"]);
    const job = jobs.find((j) => j.data.workUnitId === workUnitId);
    expect(job).toBeTruthy();
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: "exponential", delay: 1000 });
  });
});

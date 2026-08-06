import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertGraderDomainStat } from "../src/workers/processSignals.js";

// processSignals.ts's signal worker runs with `concurrency: 2` — two jobs for the same grader
// (any grader with more than one batch in flight, a routine occurrence) can call
// upsertGraderDomainStat concurrently. The prior implementation read GraderStat.domainStats,
// merged in JS, then wrote it back — a classic TOCTOU race where the second write can clobber
// the first's update and silently drop a whole domain's stats. This test doesn't rely on timing
// to *catch* the race (that would be flaky); it fires genuinely concurrent calls and asserts the
// atomic INSERT ... ON CONFLICT DO UPDATE fix produces exactly the correct totals regardless of
// interleaving — the guarantee now comes from Postgres row-level locking, not JS scheduling.
const prisma = new PrismaClient();

const runId = Math.random().toString(36).slice(2);
const tenantId = `domain-stat-race-tenant-${runId}`;
const graderId = `domain-stat-race-grader-${runId}`;

afterEach(async () => {
  await prisma.graderStat.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("upsertGraderDomainStat — concurrency", () => {
  it("loses no updates when 20 calls across two domains race concurrently, including the very first insert", async () => {
    const calls = Array.from({ length: 20 }, (_, i) => {
      const domain = i % 2 === 0 ? "code" : "math";
      const fired = i % 3 === 0;
      return upsertGraderDomainStat(prisma, tenantId, graderId, domain, fired);
    });

    await Promise.all(calls);

    const stat = await prisma.graderStat.findUniqueOrThrow({ where: { tenantId_graderId: { tenantId, graderId } } });
    const domainStats = stat.domainStats as Record<string, { itemsSeen: number; flagCount: number }>;

    const codeIndices = Array.from({ length: 20 }, (_, i) => i).filter((i) => i % 2 === 0);
    const mathIndices = Array.from({ length: 20 }, (_, i) => i).filter((i) => i % 2 === 1);
    const flagCount = (indices: number[]) => indices.filter((i) => i % 3 === 0).length;

    expect(stat.itemsSeen).toBe(20);
    expect(stat.flagCount).toBe(flagCount(codeIndices) + flagCount(mathIndices));
    expect(domainStats.code).toEqual({ itemsSeen: codeIndices.length, flagCount: flagCount(codeIndices) });
    expect(domainStats.math).toEqual({ itemsSeen: mathIndices.length, flagCount: flagCount(mathIndices) });
  });

  it("still accumulates correctly across sequential calls to the same domain (existing behavior, unchanged)", async () => {
    await upsertGraderDomainStat(prisma, tenantId, graderId, "law", true);
    await upsertGraderDomainStat(prisma, tenantId, graderId, "law", false);
    await upsertGraderDomainStat(prisma, tenantId, graderId, "safety", true);

    const stat = await prisma.graderStat.findUniqueOrThrow({ where: { tenantId_graderId: { tenantId, graderId } } });
    const domainStats = stat.domainStats as Record<string, { itemsSeen: number; flagCount: number }>;

    expect(stat.itemsSeen).toBe(3);
    expect(stat.flagCount).toBe(2);
    expect(domainStats.law).toEqual({ itemsSeen: 2, flagCount: 1 });
    expect(domainStats.safety).toEqual({ itemsSeen: 1, flagCount: 1 });
  });
});

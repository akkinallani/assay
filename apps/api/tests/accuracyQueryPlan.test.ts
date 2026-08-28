import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { firedSignalsWhere } from "../src/routes/verdicts.js";

// GET /accuracy's firedSignals query (apps/api/src/routes/verdicts.ts) reaches WorkUnit and
// Verdict through nested relation filters. Without tenantId repeated at each nested level,
// Prisma's generated SQL leaves those two joins fully unconstrained — Postgres then has no way
// to avoid scanning the entire WorkUnit/Verdict tables, system-wide across every tenant, on
// every load of this page. Verified directly against realistic multi-tenant data (40k rows
// across 5 tenants) via EXPLAIN ANALYZE before writing the fix: unscoped nested filters produced
// two Seq Scans; scoping them produced Bitmap/Index scans on each table's existing tenantId
// index, at roughly half the execution time and a growing gap as total platform rows grow.
//
// This test captures the *real* SQL Prisma generates for the production where-clause shape
// (mirrored from verdicts.ts, not hand-approximated) and asserts Postgres can push the tenantId
// condition into both joined tables — forcing enable_seqscan off within a transaction so the
// assertion is deterministic regardless of this test database's tiny row count (a near-empty
// table would otherwise always cost-favor a seq scan by default either way).
describe("GET /accuracy — firedSignals query plan", () => {
  it("scopes the WorkUnit and Verdict joins by tenantId, not just the top-level Signal filter", async () => {
    let capturedSql: string | undefined;
    const logging = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    logging.$on("query", (e) => {
      if (e.query.includes('"Signal"') && e.query.includes('"Verdict"')) capturedSql = e.query;
    });

    const tenantId = "query-plan-check-nonexistent-tenant";
    await logging.signal.findMany({
      where: firedSignalsWhere(tenantId),
      select: {
        key: true,
        createdAt: true,
        workUnit: { select: { verdict: { select: { resolutionOutcome: true, resolvedAt: true } } } },
      },
    });
    await logging.$disconnect();

    expect(capturedSql, "expected the firedSignals query to actually run and get logged").toBeTruthy();

    const planText = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
      const plan = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN ${capturedSql!.replace(/OFFSET \$\d+\s*$/, "OFFSET 0")}`,
        tenantId,
        true,
        tenantId,
        tenantId
      );
      return plan.map((row) => row["QUERY PLAN"]).join("\n");
    });

    expect(planText).toContain("WorkUnit_tenantId_batchId_idx");
    expect(planText).toContain("Verdict_tenantId_idx");
    expect(planText).not.toContain('Seq Scan on "WorkUnit"');
    expect(planText).not.toContain('Seq Scan on "Verdict"');
  });
});

const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

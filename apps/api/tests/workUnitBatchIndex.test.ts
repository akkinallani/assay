import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

// computeBatchProgress (apps/api/src/events/bus.ts) filters WorkUnit — directly, and via a join
// for Verdict/Signal — by batchId alone, with no tenantId predicate. The only other WorkUnit
// index, [tenantId, batchId], can't be used for a query that leaves tenantId unconstrained, so
// this call (which runs on every batch upload and every regrade job's completion, both routine,
// high-frequency events) forced a full sequential scan of every WorkUnit row across every
// tenant. Confirms the dedicated batchId index exists and that Postgres can actually use it for
// exactly this query shape, rather than just asserting the migration ran.
describe("WorkUnit.batchId index", () => {
  it("exists on the WorkUnit table", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'WorkUnit'
    `;
    expect(indexes.map((i) => i.indexname)).toContain("WorkUnit_batchId_idx");
  });

  it("is usable by a batchId-only query, the exact shape computeBatchProgress runs", async () => {
    const planText = await prisma.$transaction(async (tx) => {
      // SET LOCAL only takes effect within a transaction, and forcing the planner off seqscan
      // is the deterministic way to prove the index *can* satisfy this query shape — the
      // planner may otherwise reasonably prefer a seqscan on a near-empty test table regardless
      // of which indexes exist, which would make an unforced assertion meaningless here.
      await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
      const plan = await tx.$queryRaw<Array<{ "QUERY PLAN": string }>>`
        EXPLAIN SELECT count(*) FROM "WorkUnit" WHERE "batchId" = 'plan-check-nonexistent-batch'
      `;
      return plan.map((row) => row["QUERY PLAN"]).join("\n");
    });

    expect(planText).toContain("WorkUnit_batchId_idx");
    expect(planText).not.toContain('Seq Scan on "WorkUnit"');
  });
});

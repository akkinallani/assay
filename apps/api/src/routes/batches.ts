import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { genericJsonAdapter, ValidationError } from "../ingestion/adapters/genericJson.js";
import { signalQueue } from "../workers/processSignals.js";
import type { Redis } from "ioredis";
import { badRequest, conflict, notFound } from "../errors.js";

export default function batchRoutes(redis: Redis): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post("/batches", async (request, reply) => {
      const tenantId = request.tenantId;

      let units;
      try {
        units = genericJsonAdapter(request.body);
      } catch (err) {
        if (err instanceof ValidationError) {
          throw badRequest("validation_failed", "Validation failed", err.issues);
        }
        throw err;
      }

      let batchId: string;
      try {
        const batch = await fastify.prisma.$transaction(async (tx) => {
          const created = await tx.batch.create({ data: { tenantId, status: "pending" } });

          await tx.workUnit.createMany({
            data: units.map((u) => ({
              id: u.id,
              tenantId,
              batchId: created.id,
              domain: u.domain,
              task: u.task,
              rubric: u.rubric as unknown as object,
              modelOutput: u.modelOutput,
              attachments: u.attachments ? (u.attachments as unknown as object) : undefined,
              grade: u.grade as unknown as object,
              graderId: u.graderId,
              timeSpentSec: u.timeSpentSec,
              createdAt: new Date(u.createdAt),
            })),
          });

          return created;
        });
        batchId = batch.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const duplicateIds = units
            .map((u) => u.id)
            .filter((id, i, arr) => arr.indexOf(id) !== i);
          throw conflict(
            "duplicate_work_unit_id",
            duplicateIds.length > 0
              ? `Duplicate ids within this upload: ${duplicateIds.join(", ")}`
              : "One or more work unit ids already exist from a previous upload. Work unit ids must be globally unique."
          );
        }
        throw err;
      }

      const queue = signalQueue(redis);
      await queue.add("process-signals", { batchId, tenantId });

      return reply.code(201).send({ batchId, unitCount: units.length });
    });

    fastify.get("/batches", async (request) => {
      const tenantId = request.tenantId;
      const batches = await fastify.prisma.batch.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { units: true } } },
      });
      return batches.map((b) => ({ ...b, unitCount: b._count.units }));
    });

    fastify.get("/batches/:id/verdict", async (request) => {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;

      const batch = await fastify.prisma.batch.findFirst({ where: { id, tenantId } });
      if (!batch) throw notFound("batch_not_found");

      const verdicts = await fastify.prisma.verdict.findMany({
        where: { workUnit: { batchId: id, tenantId } },
        include: {
          workUnit: { include: { signals: true } },
        },
        orderBy: { risk: "desc" },
      });

      return verdicts;
    });

    fastify.get("/batches/:batchId/units/:unitId", async (request) => {
      const { batchId, unitId } = request.params as { batchId: string; unitId: string };
      const tenantId = request.tenantId;

      const unit = await fastify.prisma.workUnit.findFirst({
        where: { id: unitId, batchId, tenantId },
        include: { signals: true, verdict: true },
      });

      if (!unit) throw notFound("unit_not_found");
      return unit;
    });
  };
}

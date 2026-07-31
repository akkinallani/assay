import type { Signal, WorkUnit } from "@quorum/schema";

export type { Signal };

export interface BatchContext {
  batchId: string;
  cohortStats: Map<string, CohortStat>;
}

export interface CohortStat {
  mean: number;
  stdDev: number;
  count: number;
}

export type SignalFn = (unit: WorkUnit, ctx: BatchContext) => Signal;

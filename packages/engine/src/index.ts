export { consistencySignal } from "./signals/consistency.js";
export { coverageSignal } from "./signals/coverage.js";
export { cohortSignal, computeCohortStats, cohortKey } from "./signals/cohort.js";
export { regradeSignal } from "./signals/regrade.js";
export { scoreSignals, riskToRecommendation, buildVerdict } from "./scorer.js";
export type { BatchContext, SignalFn } from "./signals/types.js";
export { checkRubricCoherence } from "./verification/rubricCoherence.js";
export type { CoherenceResult } from "./verification/rubricCoherence.js";

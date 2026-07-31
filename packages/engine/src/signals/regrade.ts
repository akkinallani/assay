import type { AgentRegradeResult, WorkUnit } from "@quorum/schema";
import type { Signal } from "./types.js";

export function regradeSignal(unit: WorkUnit, result: AgentRegradeResult): Signal {
  const humanPct = unit.grade.score / unit.grade.maxScore;
  const agentPct = result.agentScore / result.agentMaxScore;
  const divergence = Math.abs(humanPct - agentPct);

  const fired = divergence > 0.2;

  const direction = agentPct < humanPct ? "lower" : "higher";
  const evidence = fired
    ? `Agent re-grade scored ${Math.round(agentPct * 100)}% vs human ${Math.round(humanPct * 100)}% (${Math.round(divergence * 100)}% divergence). Agent found: ${result.agentReasoning.slice(0, 200)}`
    : `Agent re-grade agrees with human grade (${Math.round(divergence * 100)}% divergence, ${direction})`;

  return {
    key: "regrade",
    fired,
    weight: 0.8,
    evidence,
    detail: result,
  };
}

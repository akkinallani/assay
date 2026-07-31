import type { AgentRegradeResult, WorkUnit } from "@quorum/schema";
import type { Signal } from "./types.js";

export function regradeSignal(unit: WorkUnit, result: AgentRegradeResult): Signal {
  const humanPct = unit.grade.score / unit.grade.maxScore;
  const agentPct = result.agentScore / result.agentMaxScore;
  const divergence = Math.abs(humanPct - agentPct);

  const divergent = divergence > 0.2;
  const coherenceIssues = result.coherenceIssues ?? [];
  const hasCoherenceIssues = coherenceIssues.length > 0;
  // An internally-incoherent agent grade shouldn't count as confirming the human grade just
  // because the final numbers happen to line up — fire on either signal independently.
  const fired = divergent || hasCoherenceIssues;

  const direction = agentPct < humanPct ? "lower" : "higher";
  const divergenceText = divergent
    ? `Agent re-grade scored ${Math.round(agentPct * 100)}% vs human ${Math.round(humanPct * 100)}% (${Math.round(divergence * 100)}% divergence). Agent found: ${result.agentReasoning.slice(0, 200)}`
    : `Agent re-grade agrees with human grade (${Math.round(divergence * 100)}% divergence, ${direction})`;

  const coherenceText = hasCoherenceIssues
    ? `Agent's own reasoning may be unreliable: ${coherenceIssues.join("; ")}`
    : "";

  const evidence = [divergenceText, coherenceText].filter(Boolean).join(". ");

  return {
    key: "regrade",
    fired,
    weight: 0.8,
    evidence,
    detail: result,
  };
}

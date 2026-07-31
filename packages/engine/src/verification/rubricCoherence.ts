import type { AgentCriterionScore, RubricCriterion } from "@quorum/schema";

export interface CoherenceResult {
  coherent: boolean;
  issues: string[];
}

// Threshold above which a score reads as "essentially passing" — if any required criterion is
// unmet, a score this high is internally inconsistent with the agent's own stated reasoning.
const HIGH_SCORE_THRESHOLD = 0.85;

/**
 * Deterministic (no LLM) check that an agent's per-criterion breakdown actually supports the
 * overall score it gave. This is what makes "chain-of-thought verification" real rather than a
 * buzzword — it catches an agent hand-waving a score that its own stated criteria contradict.
 */
export function checkRubricCoherence(
  rubric: RubricCriterion[],
  criteriaScores: AgentCriterionScore[],
  score: number,
  maxScore: number
): CoherenceResult {
  const issues: string[] = [];
  const criteriaById = new Map(criteriaScores.map((c) => [c.criterionId, c]));
  const rubricIds = new Set(rubric.map((c) => c.id));

  const requiredCriteria = rubric.filter((c) => c.required);
  const missingRequired = requiredCriteria.filter((c) => !criteriaById.has(c.id));
  if (missingRequired.length > 0) {
    issues.push(
      `Agent's breakdown skipped ${missingRequired.length} required criteri${missingRequired.length === 1 ? "on" : "a"}: ${missingRequired
        .map((c) => `"${c.text}"`)
        .join(", ")}`
    );
  }

  const orphanEntries = criteriaScores.filter((c) => !rubricIds.has(c.criterionId));
  if (orphanEntries.length > 0) {
    issues.push(
      `Agent's breakdown references ${orphanEntries.length} criterion id${orphanEntries.length === 1 ? "" : "s"} not in the rubric`
    );
  }

  const unmetRequired = requiredCriteria.filter((c) => criteriaById.get(c.id)?.met === false);
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (unmetRequired.length > 0 && pct > HIGH_SCORE_THRESHOLD) {
    issues.push(
      `Agent scored ${Math.round(pct * 100)}% but marked ${unmetRequired.length} required criteri${unmetRequired.length === 1 ? "on" : "a"} as unmet: ${unmetRequired
        .map((c) => `"${c.text}"`)
        .join(", ")}`
    );
  }

  return { coherent: issues.length === 0, issues };
}

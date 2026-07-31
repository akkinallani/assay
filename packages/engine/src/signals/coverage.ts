import type { WorkUnit } from "@quorum/schema";
import type { BatchContext, Signal } from "./types.js";

function keywordsFromText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
}

export function coverageSignal(unit: WorkUnit, _ctx: BatchContext): Signal {
  const requiredCriteria = unit.rubric.filter((c) => c.required);

  if (requiredCriteria.length === 0) {
    return { key: "coverage", fired: false, weight: 0.4, evidence: "No required criteria in rubric" };
  }

  const missedCriteria: string[] = [];

  if (unit.grade.criteriaScores && unit.grade.criteriaScores.length > 0) {
    const scoredIds = new Set(unit.grade.criteriaScores.map((cs) => cs.criterionId));
    for (const criterion of requiredCriteria) {
      if (!scoredIds.has(criterion.id)) {
        missedCriteria.push(criterion.text);
      }
    }
  } else {
    const reasoningLower = unit.grade.reasoning.toLowerCase();
    for (const criterion of requiredCriteria) {
      const keywords = keywordsFromText(criterion.text);
      const covered = keywords.some((kw) => reasoningLower.includes(kw));
      if (!covered) {
        missedCriteria.push(criterion.text);
      }
    }
  }

  const hasSafetyCriterion = requiredCriteria.some((c) =>
    c.text.toLowerCase().includes("safe")
  );
  const safetyMissed = missedCriteria.some((t) => t.toLowerCase().includes("safe"));

  // Safety-domain hard flag: safety criterion unaddressed → high weight
  const isSafetyHardFlag = unit.domain === "safety" && hasSafetyCriterion && safetyMissed;
  const weight = isSafetyHardFlag ? 0.9 : 0.5;

  const fired = missedCriteria.length > 0;
  const evidence = fired
    ? `Required criteria not addressed in reasoning: ${missedCriteria.slice(0, 3).map((t) => `"${t}"`).join(", ")}`
    : "All required criteria addressed in reasoning";

  return { key: "coverage", fired, weight, evidence };
}

import type { WorkUnit } from "@quorum/schema";
import type { BatchContext, Signal } from "./types.js";

function keywordsFromText(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 0);
  // Prefer longer words to avoid over-matching common short words, but a criterion made up
  // entirely of short words (e.g. "Do not lie") must still fall back to them — otherwise this
  // returns [], and `[].some(...)` is unconditionally false, marking every such criterion as
  // missed regardless of what the reasoning actually says.
  const longWords = words.filter((w) => w.length > 3);
  return longWords.length > 0 ? longWords : words;
}

// Word-boundary match, not a plain substring test — a short keyword like "not" or "do" would
// otherwise match inside unrelated words ("noted", "document"), silently reporting a criterion
// as covered when the reasoning never actually addresses it.
function containsKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`).test(text);
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
      const covered = keywords.some((kw) => containsKeyword(reasoningLower, kw));
      if (!covered) {
        missedCriteria.push(criterion.text);
      }
    }
  }

  // Safety-domain hard flag: any required criterion unaddressed → high weight. Gated on
  // unit.domain alone (not on the criterion text containing the literal word "safe") — real
  // safety rubrics are commonly phrased with "harm", "danger", "abuse", etc., and unit.domain
  // is already the authoritative signal that every required criterion here is safety-relevant.
  const isSafetyHardFlag = unit.domain === "safety" && missedCriteria.length > 0;
  const weight = isSafetyHardFlag ? 0.9 : 0.5;

  const fired = missedCriteria.length > 0;
  const evidence = fired
    ? `Required criteria not addressed in reasoning: ${missedCriteria.slice(0, 3).map((t) => `"${t}"`).join(", ")}`
    : "All required criteria addressed in reasoning";

  return { key: "coverage", fired, weight, evidence };
}

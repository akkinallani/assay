import type { WorkUnit } from "@quorum/schema";
import type { BatchContext, Signal } from "./types.js";

export function taskTemplate(task: string): string {
  return task.slice(0, 60).toLowerCase().replace(/\s+/g, " ").trim();
}

export function cohortKey(unit: WorkUnit): string {
  return `${unit.domain}::${taskTemplate(unit.task)}`;
}

export function computeCohortStats(units: WorkUnit[]): Map<string, { mean: number; stdDev: number; count: number }> {
  const groups = new Map<string, number[]>();

  for (const unit of units) {
    const key = cohortKey(unit);
    const pct = unit.grade.score / unit.grade.maxScore;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pct);
  }

  const stats = new Map<string, { mean: number; stdDev: number; count: number }>();
  for (const [key, scores] of groups) {
    if (scores.length < 3) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
    stats.set(key, { mean, stdDev: Math.sqrt(variance), count: scores.length });
  }

  return stats;
}

export function cohortSignal(unit: WorkUnit, ctx: BatchContext): Signal {
  const key = cohortKey(unit);
  const stat = ctx.cohortStats.get(key);

  if (!stat || stat.count < 3) {
    return {
      key: "cohort",
      fired: false,
      weight: 0.45,
      evidence: "Insufficient cohort size for comparison",
    };
  }

  const pct = unit.grade.score / unit.grade.maxScore;
  const zScore = stat.stdDev > 0 ? Math.abs(pct - stat.mean) / stat.stdDev : 0;
  const fired = zScore > 2;

  const direction = pct < stat.mean ? "below" : "above";
  const evidence = fired
    ? `Grader ${unit.graderId} scored ${Math.round(pct * 100)}% on this ${unit.domain} item; cohort mean is ${Math.round(stat.mean * 100)}% (±${Math.round(stat.stdDev * 100)}%) — ${zScore.toFixed(1)}SD ${direction} mean`
    : `Score within normal cohort range (${zScore.toFixed(1)}SD from mean of ${Math.round(stat.mean * 100)}%)`;

  return { key: "cohort", fired, weight: 0.45, evidence };
}

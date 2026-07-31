import type { Signal, Recommendation, Verdict } from "@quorum/schema";

export function scoreSignals(signals: Signal[]): number {
  return signals
    .filter((s) => s.fired)
    .reduce((acc, s) => 1 - (1 - acc) * (1 - s.weight), 0);
}

export function riskToRecommendation(risk: number): Recommendation {
  if (risk < 0.25) return "clear";
  if (risk < 0.6) return "spot_check";
  return "re_review";
}

export function buildVerdict(workUnitId: string, signals: Signal[]): Verdict {
  const risk = scoreSignals(signals);
  const recommendation = riskToRecommendation(risk);
  return { workUnitId, risk, recommendation, signals };
}

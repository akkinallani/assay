import type { WorkUnit } from "@quorum/schema";
import type { BatchContext, Signal } from "./types.js";

const NEGATIVE_WORDS = [
  "failed", "incorrect", "wrong", "missing", "error", "incomplete",
  "inadequate", "poor", "lacks", "absent", "omitted", "invalid",
  "insufficient", "flawed", "mistaken", "inaccurate", "unclear",
];

const POSITIVE_WORDS = [
  "correct", "accurate", "complete", "thorough", "excellent", "good",
  "proper", "valid", "appropriate", "satisfactory", "meets", "addressed",
  "demonstrates", "clearly", "well", "precise",
];

function sentimentScore(text: string): number {
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/);
  let score = 0;
  for (const word of words) {
    if (NEGATIVE_WORDS.includes(word)) score -= 1;
    if (POSITIVE_WORDS.includes(word)) score += 1;
  }
  return score;
}

export function consistencySignal(unit: WorkUnit, _ctx: BatchContext): Signal {
  const pct = unit.grade.score / unit.grade.maxScore;
  const sentiment = sentimentScore(unit.grade.reasoning);
  const reasoningLen = unit.grade.reasoning.split(/\W+/).length;
  const normalizedSentiment = reasoningLen > 0 ? sentiment / Math.sqrt(reasoningLen) : 0;

  // PROD: replace sentiment heuristic with LLM classifier
  const highScoreBadReasoning = pct > 0.85 && normalizedSentiment < -0.3;
  const lowScoreGoodReasoning = pct < 0.35 && normalizedSentiment > 0.3;

  const fired = highScoreBadReasoning || lowScoreGoodReasoning;

  let evidence = "";
  if (highScoreBadReasoning) {
    evidence = `Score is ${Math.round(pct * 100)}% but reasoning uses primarily negative language (sentiment: ${normalizedSentiment.toFixed(2)})`;
  } else if (lowScoreGoodReasoning) {
    evidence = `Score is ${Math.round(pct * 100)}% but reasoning uses primarily positive language (sentiment: ${normalizedSentiment.toFixed(2)})`;
  } else {
    evidence = "Score and reasoning sentiment are consistent";
  }

  return { key: "consistency", fired, weight: 0.5, evidence };
}

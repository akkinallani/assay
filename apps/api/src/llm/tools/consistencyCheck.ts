import type { WorkUnit } from "@quorum/schema";
import { llmCall } from "../index.js";

export interface ConsistencyCheckResult {
  consistent: boolean;
  evidence: string;
}

const CONSISTENCY_SYSTEM = `You are auditing a human grader's work. You will be given a task, the model output being graded, and the grader's numeric score plus written reasoning.
Judge whether the reasoning genuinely supports the score given — not whether the model output itself is good.
Respond with JSON only, no other text: {"consistent": boolean, "evidence": "one sentence explanation"}`;

export async function checkConsistencyWithLLM(unit: WorkUnit, jobId?: string): Promise<ConsistencyCheckResult> {
  const pct = Math.round((unit.grade.score / unit.grade.maxScore) * 100);

  const { content } = await llmCall({
    model: process.env.OLLAMA_MODEL ?? "llama3.1",
    system: CONSISTENCY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Task:\n${unit.task}\n\nModel Output:\n${unit.modelOutput}\n\nGrader's Score: ${unit.grade.score}/${unit.grade.maxScore} (${pct}%)\nGrader's Reasoning: ${unit.grade.reasoning}\n\nIs the reasoning consistent with the score?`,
      },
    ],
    maxTokens: 256,
    jobId,
  });

  try {
    const jsonMatch = content.match(/\{[^{}]*"consistent"[^{}]*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { consistent: boolean; evidence: string };
      return { consistent: parsed.consistent, evidence: parsed.evidence };
    }
  } catch {
    // fall through to default below
  }

  return { consistent: true, evidence: "Could not parse LLM consistency audit; defaulting to consistent." };
}

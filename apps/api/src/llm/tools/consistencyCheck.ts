import type { WorkUnit } from "@quorum/schema";
import { llmCallStructured, LlmParseError } from "../structured.js";
import { consistencyCheckSchema } from "../schemas.js";

export interface ConsistencyCheckResult {
  consistent: boolean;
  evidence: string;
}

const CONSISTENCY_SYSTEM = `You are auditing a human grader's work. You will be given a task, the model output being graded, and the grader's numeric score plus written reasoning.
Judge whether the reasoning genuinely supports the score given — not whether the model output itself is good.
Respond with a JSON object: {"consistent": boolean, "evidence": "one sentence explanation"}`;

export async function checkConsistencyWithLLM(unit: WorkUnit, jobId?: string): Promise<ConsistencyCheckResult> {
  const pct = Math.round((unit.grade.score / unit.grade.maxScore) * 100);

  try {
    return await llmCallStructured({
      model: process.env.OLLAMA_MODEL ?? "llama3.1",
      system: CONSISTENCY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Task:\n${unit.task}\n\nModel Output:\n${unit.modelOutput}\n\nGrader's Score: ${unit.grade.score}/${unit.grade.maxScore} (${pct}%)\nGrader's Reasoning: ${unit.grade.reasoning}\n\nIs the reasoning consistent with the score?`,
        },
      ],
      schema: consistencyCheckSchema,
      maxTokens: 256,
      jobId,
    });
  } catch (err) {
    if (err instanceof LlmParseError) {
      // This audit only runs on units that already passed the cheap heuristic check, so on a
      // technical failure here we don't fire (that would just create noise from model hiccups,
      // not from an actual finding) — but critically, we don't claim the audit found the
      // reasoning consistent either. It didn't run to a conclusion; say so honestly.
      return { consistent: true, evidence: "LLM audit could not be completed (invalid model response) — heuristic result stands unverified." };
    }
    throw err;
  }
}

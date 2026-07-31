import { llmCallStructured, LlmParseError } from "../structured.js";
import { mathVerifySchema } from "../schemas.js";

export interface MathVerifyResult {
  correct: boolean;
  explanation: string;
}

export async function verifyMathClaim(
  claim: string,
  context: string,
  jobId?: string
): Promise<MathVerifyResult> {
  try {
    return await llmCallStructured({
      model: process.env.OLLAMA_MODEL ?? "llama3.1",
      system: `You are a mathematical verifier. Given a mathematical claim and context, determine if the claim is correct.
Respond with a JSON object: {"correct": boolean, "explanation": "one sentence explanation"}`,
      messages: [
        {
          role: "user",
          content: `Context:\n${context}\n\nClaim to verify:\n${claim}`,
        },
      ],
      schema: mathVerifySchema,
      maxTokens: 256,
      jobId,
    });
  } catch (err) {
    if (err instanceof LlmParseError) {
      // Fail closed: this result is fed back to the grading agent as tool output, and an
      // unverified claim should never be reported as "correct".
      return { correct: false, explanation: "Math verification could not be completed (invalid model response)." };
    }
    throw err;
  }
}

import { llmCall } from "../index.js";

export interface MathVerifyResult {
  correct: boolean;
  explanation: string;
}

export async function verifyMathClaim(
  claim: string,
  context: string,
  jobId?: string
): Promise<MathVerifyResult> {
  const { content } = await llmCall({
    model: process.env.OLLAMA_MODEL ?? "llama3.1",
    system: `You are a mathematical verifier. Given a mathematical claim and context, determine if the claim is correct.
Respond with JSON: {"correct": boolean, "explanation": "one sentence explanation"}`,
    messages: [
      {
        role: "user",
        content: `Context:\n${context}\n\nClaim to verify:\n${claim}`,
      },
    ],
    maxTokens: 256,
    jobId,
  });

  try {
    const jsonMatch = content.match(/\{[^}]+\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as MathVerifyResult;
    }
  } catch {}

  return { correct: false, explanation: "Could not parse verification result" };
}

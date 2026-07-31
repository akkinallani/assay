import type { Attachment } from "@quorum/schema";
import { llmCallStructured, LlmParseError } from "../structured.js";
import { factCheckSchema } from "../schemas.js";

export interface FactCheckResult {
  claims: Array<{ claim: string; verdict: "supported" | "unsupported" | "contradicted"; evidence: string }>;
}

// Scoped honestly: this verifies claims against supplied context/attachments only. There is no
// external search — a claim with no supporting or contradicting reference material comes back
// "unsupported", not "true". General internet fact-checking is out of scope until a search tool
// exists.
const FACT_CHECK_SYSTEM = `You are a fact-checker. You will be given a piece of text (a model's output) and reference context (the task description and, if provided, source attachments).
Extract the discrete factual claims made in the text, and for each one, classify it against the reference context ONLY — do not use outside knowledge:
- "supported": the reference context confirms the claim
- "contradicted": the reference context directly conflicts with the claim
- "unsupported": the reference context neither confirms nor denies the claim (this is common and is not itself an error)
If the text makes no checkable factual claims, return an empty claims array.
Respond with a JSON object: {"claims": [{"claim": string, "verdict": "supported"|"unsupported"|"contradicted", "evidence": string}]}`;

export async function checkFacts(
  text: string,
  task: string,
  attachments: Attachment[] = [],
  jobId?: string
): Promise<FactCheckResult> {
  const referenceContext = [`Task:\n${task}`, ...attachments.map((a) => `Attachment "${a.name}":\n${a.content}`)].join(
    "\n\n"
  );

  try {
    return await llmCallStructured({
      model: process.env.OLLAMA_MODEL ?? "llama3.1",
      system: FACT_CHECK_SYSTEM,
      messages: [{ role: "user", content: `Reference context:\n${referenceContext}\n\nText to fact-check:\n${text}` }],
      schema: factCheckSchema,
      maxTokens: 512,
      jobId,
    });
  } catch (err) {
    if (err instanceof LlmParseError) {
      // Fail closed by omission: report no verified claims rather than fabricating a verdict.
      return { claims: [] };
    }
    throw err;
  }
}

import type { ZodError, ZodType } from "zod";
import { llmCall, type MessageParam } from "./index.js";

/** Thrown when the model still hasn't produced schema-valid output after retrying once.
 *  Callers decide fail-open vs fail-closed for their own context — this never fabricates a result. */
export class LlmParseError extends Error {
  raw: string;
  cause: SyntaxError | ZodError;

  constructor(raw: string, cause: SyntaxError | ZodError) {
    super(`LLM response did not match the expected schema after retrying: ${cause.message}`);
    this.raw = raw;
    this.cause = cause;
  }
}

function extractJson(content: string): unknown {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new SyntaxError("No JSON object found in the response");
  return JSON.parse(jsonMatch[0]);
}

/**
 * Calls the model requesting JSON output, validates the result against `schema`, and retries
 * once with a corrective follow-up message if parsing or validation fails. Throws `LlmParseError`
 * if the second attempt also fails — it never silently returns a default/guessed value.
 */
export async function llmCallStructured<T>(params: {
  model: string;
  system: string;
  messages: MessageParam[];
  schema: ZodType<T>;
  maxTokens?: number;
  jobId?: string;
}): Promise<T> {
  const messages = [...params.messages];
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await llmCall({
      model: params.model,
      system: params.system,
      messages,
      maxTokens: params.maxTokens,
      jobId: params.jobId,
      jsonMode: true,
    });

    let parsedJson: unknown;
    try {
      parsedJson = extractJson(result.content);
    } catch (err) {
      if (attempt === maxAttempts) throw new LlmParseError(result.content, err as SyntaxError);
      messages.push({ role: "assistant", content: result.content });
      messages.push({
        role: "user",
        content: `That wasn't valid JSON (${(err as Error).message}). Respond again with ONLY a single valid JSON object — no other text.`,
      });
      continue;
    }

    const validated = params.schema.safeParse(parsedJson);
    if (validated.success) return validated.data;

    if (attempt === maxAttempts) throw new LlmParseError(result.content, validated.error);
    messages.push({ role: "assistant", content: result.content });
    messages.push({
      role: "user",
      content: `That JSON didn't match the required shape: ${validated.error.message}. Respond again with ONLY a corrected JSON object.`,
    });
  }

  // Unreachable — the loop always returns or throws by the final attempt.
  throw new Error("llmCallStructured: exhausted attempts without returning or throwing");
}

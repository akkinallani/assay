export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

// Generous enough to cover a slow local-model generation under normal load, but bounded so a
// backend that accepts the connection and then never responds (model swap thrashing, GPU/CPU
// exhaustion, a worker crash mid-generation) can't hang the calling job forever.
export const LLM_CALL_TIMEOUT_MS = 120_000;

// Node's fetch() reports connection failures as `TypeError: fetch failed`, with the actual
// cause (e.g. ECONNREFUSED) nested in `err.cause`, never in `err.message` itself.
function isConnRefusedError(err: unknown): boolean {
  if (err instanceof Error && err.message.includes("ECONNREFUSED")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause instanceof Error && cause.message.includes("ECONNREFUSED")) return true;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return (cause as { code?: unknown }).code === "ECONNREFUSED";
  }
  return false;
}

// AbortSignal.timeout() rejects fetch() with a DOMException named "TimeoutError" — verified
// directly against Node's native fetch (not documentation), since implementations vary.
function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

function toOllamaTools(tools?: LlmTool[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export async function llmCall(params: {
  model: string;
  system: string;
  messages: MessageParam[];
  tools?: LlmTool[];
  maxTokens?: number;
  jobId?: string;
  /** Requests Ollama's basic JSON-mode flag — constrains output to valid JSON syntax
   *  (not a specific schema). Combine with runtime schema validation, not a substitute for it. */
  jsonMode?: boolean;
}): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          messages: [{ role: "system", content: params.system }, ...params.messages],
          tools: toOllamaTools(params.tools),
          stream: false,
          format: params.jsonMode ? "json" : undefined,
          options: { num_predict: params.maxTokens ?? 4096 },
        }),
        signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }

      const data = (await response.json()) as {
        message: { content: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const inputTokens = data.prompt_eval_count ?? 0;
      const outputTokens = data.eval_count ?? 0;

      console.log(
        JSON.stringify({
          event: "llm_call",
          jobId: params.jobId,
          model: params.model,
          inputTokens,
          outputTokens,
          costUsd: 0,
        })
      );

      return { content: data.message.content, inputTokens, outputTokens, costUsd: 0 };
    } catch (err: unknown) {
      if ((isConnRefusedError(err) || isTimeoutError(err)) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error("LLM call failed after max retries");
}

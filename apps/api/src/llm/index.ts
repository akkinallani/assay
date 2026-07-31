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
          options: { num_predict: params.maxTokens ?? 4096 },
        }),
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
      const isConnRefused = err instanceof Error && err.message.includes("ECONNREFUSED");
      if (isConnRefused && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error("LLM call failed after max retries");
}

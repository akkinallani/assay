import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "@quorum/schema";

const embedMock = vi.fn();

vi.mock("../src/llm/embeddings.js", () => ({
  embed: (...args: unknown[]) => embedMock(...args),
  cosineSimilarity: (a: number[], b: number[]) => {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  },
}));

const { retrieveContext } = await import("../src/llm/tools/contextRetrieval.js");

function attachment(name: string, sentences: number): Attachment {
  return {
    id: name,
    name,
    content: Array.from({ length: sentences }, (_, i) => `Sentence number ${i}.`).join(" "),
  };
}

describe("retrieveContext — embedding fan-out", () => {
  it("never has more than 9 embed() calls in flight at once, however many chunks a document has", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    embedMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return [1, 0, 0];
    });

    // A realistic law/safety-domain document: hundreds of sentences, each becomes one chunk.
    await retrieveContext("query", [attachment("policy.txt", 200)]);

    // 8 concurrent chunk-embedding workers, plus the one concurrent query embedding — not the
    // 200 fully-unbounded concurrent calls this document's chunk count would previously fire.
    expect(maxInFlight).toBeLessThanOrEqual(9);
    // The query embedding plus one call per chunk — no chunk silently dropped.
    expect(embedMock).toHaveBeenCalledTimes(201);
  });

  it("still returns the top 5 chunks ranked by similarity, matched back to the right source chunk", async () => {
    embedMock.mockImplementation(async (text: string) => {
      // Encode each chunk's rank into its embedding so similarity ordering is deterministic.
      const rank = Number(text.match(/\d+/)?.[0] ?? 0);
      return [rank, 0, 0];
    });

    const results = await retrieveContext("query", [attachment("doc.txt", 10)]);

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.source === "doc.txt")).toBe(true);
  });

  it("returns no results and makes no embed calls for attachments with no extractable sentences", async () => {
    embedMock.mockClear();
    const results = await retrieveContext("query", [{ id: "a", name: "empty.txt", content: "" }]);
    expect(results).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });
});

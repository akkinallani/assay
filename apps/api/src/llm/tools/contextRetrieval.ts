import type { Attachment } from "@quorum/schema";
import { embed, cosineSimilarity } from "../embeddings.js";

export interface RetrievalResult {
  text: string;
  source: string;
}

interface Chunk {
  text: string;
  source: string;
}

function chunkAttachment(attachment: Attachment): Chunk[] {
  return attachment.content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, source: attachment.name }));
}

export async function retrieveContext(query: string, attachments: Attachment[]): Promise<RetrievalResult[]> {
  const chunks = attachments.flatMap(chunkAttachment);
  if (chunks.length === 0) return [];

  const [queryEmbedding, chunkEmbeddings] = await Promise.all([
    embed(query),
    Promise.all(chunks.map((c) => embed(c.text))),
  ]);

  const ranked = chunks
    .map((chunk, i) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]) }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 5).map((r) => ({ text: r.chunk.text, source: r.chunk.source }));
}

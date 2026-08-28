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

// Attachment content has no length bound (only Fastify's 1 MiB request body limit does), and a
// realistic document — the retrieve_context tool is only offered for the law/safety domains,
// where attachments are contracts/policy docs — chunks into hundreds to thousands of sentences.
// Embedding every chunk as one giant Promise.all fires that many concurrent HTTP requests at
// the single local embedding backend at once; cap how many are ever in flight together.
const EMBED_CONCURRENCY = 8;

async function embedAll(texts: string[]): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < texts.length; i = next++) {
      results[i] = await embed(texts[i]);
    }
  }
  const workers = Array.from({ length: Math.min(EMBED_CONCURRENCY, texts.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function retrieveContext(query: string, attachments: Attachment[]): Promise<RetrievalResult[]> {
  const chunks = attachments.flatMap(chunkAttachment);
  if (chunks.length === 0) return [];

  const [queryEmbedding, chunkEmbeddings] = await Promise.all([
    embed(query),
    embedAll(chunks.map((c) => c.text)),
  ]);

  const ranked = chunks
    .map((chunk, i) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]) }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 5).map((r) => ({ text: r.chunk.text, source: r.chunk.source }));
}

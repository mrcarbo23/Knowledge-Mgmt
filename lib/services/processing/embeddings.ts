import OpenAI from "openai";
import { config } from "@/lib/config";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey(),
    });
  }
  return openaiClient;
}

export async function computeEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();

  // Truncate text if too long (max ~8000 tokens, roughly 32000 chars)
  const truncatedText = text.slice(0, 32000);

  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: truncatedText,
    dimensions: config.embeddingDimension,
  });

  return response.data[0].embedding;
}

export async function computeEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  const openai = getOpenAI();

  // Truncate each text
  const truncatedTexts = texts.map((t) => t.slice(0, 32000));

  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: truncatedTexts,
    dimensions: config.embeddingDimension,
  });

  // Sort by index to maintain order
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dot / magnitude;
}

export function cosineSimilarityMatrix(embeddings: number[][]): number[][] {
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0)
  );

  // Pre-normalize all embeddings for efficiency
  const normalized = embeddings.map((emb) => {
    const norm = Math.sqrt(emb.reduce((sum, val) => sum + val * val, 0));
    return norm > 0 ? emb.map((val) => val / norm) : emb;
  });

  // Compute dot products (cosine similarity for normalized vectors)
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      let dot = 0;
      for (let k = 0; k < normalized[i].length; k++) {
        dot += normalized[i][k] * normalized[j][k];
      }
      matrix[i][j] = dot;
      matrix[j][i] = dot;
    }
  }

  return matrix;
}

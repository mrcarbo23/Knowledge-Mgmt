import OpenAI from "openai";
import { config } from "@/lib/config";

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

export async function computeEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: text,
  });
  return response.data[0].embedding;
}

export async function computeEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: texts,
  });

  // Sort by index to maintain order
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

export function cosineSimilarityMatrix(
  embeddings: number[][]
): number[][] {
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );

  // Normalize
  const normalized = embeddings.map((emb) => {
    const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0)) || 1;
    return emb.map((v) => v / norm);
  });

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

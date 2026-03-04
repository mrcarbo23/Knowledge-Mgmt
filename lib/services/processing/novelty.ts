import { neon } from "@neondatabase/serverless";
import { config } from "@/lib/config";

export interface NoveltyResult {
  isNovel: boolean;
  isFollowup: boolean;
  maxSimilarity: number;
  similarItems: { id: number; similarity: number }[];
}

export async function checkNovelty(
  itemId: number,
  embedding: number[],
  weeksBack: number = config.noveltyWeeks
): Promise<NoveltyResult> {
  const sql = neon(process.env.DATABASE_URL!);

  // Calculate cutoff date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);

  // Use pgvector <=> operator for cosine distance
  // Note: <=> returns distance, so similarity = 1 - distance
  const embeddingStr = `[${embedding.join(",")}]`;

  const result = await sql`
    SELECT 
      id,
      1 - (embedding <=> ${embeddingStr}::vector) as similarity,
      processed_at
    FROM processed_items
    WHERE id != ${itemId}
      AND processed_at >= ${cutoff.toISOString()}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT 10
  `;

  const similarItems = result.map((row) => ({
    id: row.id as number,
    similarity: row.similarity as number,
  }));

  const maxSimilarity =
    similarItems.length > 0 ? Math.max(...similarItems.map((s) => s.similarity)) : 0;

  // Check if it's a follow-up (similar to recent content)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const isFollowup =
    result.some((row) => {
      const processedAt = new Date(row.processed_at as string);
      return (row.similarity as number) >= 0.7 && processedAt >= oneWeekAgo;
    });

  return {
    isNovel: maxSimilarity < config.semanticThreshold,
    isFollowup,
    maxSimilarity,
    similarItems,
  };
}

export async function batchCheckNovelty(
  items: { id: number; embedding: number[] }[]
): Promise<Map<number, NoveltyResult>> {
  const results = new Map<number, NoveltyResult>();

  // Process sequentially to avoid overwhelming the database
  for (const item of items) {
    const result = await checkNovelty(item.id, item.embedding);
    results.set(item.id, result);
  }

  return results;
}

import { db } from "@/lib/db";
import { processedItems, contentItems } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { sql, and, notInArray, gte, isNotNull } from "drizzle-orm";

export interface NoveltyResult {
  isNovel: boolean;
  noveltyScore: number; // 0-1, higher = more novel
  similarItems: {
    id: number;
    title: string | null;
    similarity: number;
    weekNumber: string;
  }[];
  isFollowup: boolean;
}

export async function checkNovelty(
  processedItemId: number,
  embedding: number[],
  weeksBack?: number,
  threshold?: number
): Promise<NoveltyResult> {
  const lookbackWeeks = weeksBack ?? config.noveltyWeeks;
  const similarityThreshold = threshold ?? config.semanticThreshold;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackWeeks * 7);

  // Use pgvector cosine distance to find similar items
  // cosine distance = 1 - cosine_similarity, so lower = more similar
  const embeddingStr = `[${embedding.join(",")}]`;

  const results = await db
    .select({
      id: processedItems.id,
      title: contentItems.title,
      processedAt: processedItems.processedAt,
      distance: sql<number>`${processedItems.embedding} <=> ${embeddingStr}::vector`,
    })
    .from(processedItems)
    .innerJoin(contentItems, sql`${processedItems.contentItemId} = ${contentItems.id}`)
    .where(
      and(
        sql`${processedItems.id} != ${processedItemId}`,
        gte(processedItems.processedAt, cutoffDate),
        isNotNull(processedItems.embedding)
      )
    )
    .orderBy(sql`${processedItems.embedding} <=> ${embeddingStr}::vector`)
    .limit(10);

  const similarItems: NoveltyResult["similarItems"] = [];
  let maxSimilarity = 0;

  for (const row of results) {
    const similarity = 1 - row.distance; // Convert distance to similarity
    if (similarity >= similarityThreshold) {
      const weekNum = row.processedAt
        ? `${row.processedAt.getFullYear()}-${String(
            getISOWeek(row.processedAt)
          ).padStart(2, "0")}`
        : "unknown";

      similarItems.push({
        id: row.id,
        title: row.title,
        similarity,
        weekNumber: weekNum,
      });
    }
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  // Sort by similarity descending, keep top 5
  similarItems.sort((a, b) => b.similarity - a.similarity);
  const topSimilar = similarItems.slice(0, 5);

  const isNovel = maxSimilarity < similarityThreshold;
  const noveltyScore = 1 - maxSimilarity;

  // Check for follow-up
  let isFollowup = false;
  const now = new Date();
  const currentWeek = `${now.getFullYear()}-${String(
    getISOWeek(now)
  ).padStart(2, "0")}`;
  const lastWeekDate = new Date(now);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeek = `${lastWeekDate.getFullYear()}-${String(
    getISOWeek(lastWeekDate)
  ).padStart(2, "0")}`;

  for (const item of topSimilar) {
    if (
      (item.weekNumber === currentWeek || item.weekNumber === lastWeek) &&
      item.similarity >= 0.7
    ) {
      isFollowup = true;
      break;
    }
  }

  return { isNovel, noveltyScore, similarItems: topSimilar, isFollowup };
}

export async function batchCheckNovelty(
  items: Array<{ id: number; embedding: number[] }>,
  weeksBack?: number,
  threshold?: number
): Promise<Map<number, NoveltyResult>> {
  const results = new Map<number, NoveltyResult>();

  // Process sequentially to avoid overwhelming the DB
  for (const item of items) {
    const result = await checkNovelty(
      item.id,
      item.embedding,
      weeksBack,
      threshold
    );
    results.set(item.id, result);
  }

  return results;
}

function getISOWeek(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
}

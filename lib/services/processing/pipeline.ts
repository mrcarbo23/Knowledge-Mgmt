import { db, schema } from "@/lib/db";
import { eq, isNull, sql, and, gte, lte } from "drizzle-orm";
import { config } from "@/lib/config";
import {
  computeFingerprint,
  areFingerprintsSimilar,
} from "./fingerprint";
import { computeEmbedding } from "./embeddings";
import { extractContent } from "./extractor";
import { clusterItems, mergeClusters } from "./clustering";
import { batchCheckNovelty } from "./novelty";

export interface ProcessingResult {
  itemsProcessed: number;
  itemsSkipped: number;
  itemsFailed: number;
  duplicatesFound: number;
  clustersCreated: number;
  errors: string[];
}

function getWeekNumber(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

function getWeekDateRange(weekNumber: string): { start: Date; end: Date } {
  const [year, week] = weekNumber.split("-W").map(Number);
  const jan1 = new Date(year, 0, 1);
  const days = (week - 1) * 7 - jan1.getDay() + 1;
  const start = new Date(year, 0, days + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export async function processNewItems(
  weekNumber?: string,
  batchSize = 10
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    itemsProcessed: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    duplicatesFound: 0,
    clustersCreated: 0,
    errors: [],
  };

  const currentWeek = weekNumber || getWeekNumber(new Date());
  const { start, end } = getWeekDateRange(currentWeek);

  // Get unprocessed items
  const unprocessedItems = await db
    .select({
      content: schema.contentItems,
      source: schema.sources,
    })
    .from(schema.contentItems)
    .leftJoin(
      schema.processedItems,
      eq(schema.contentItems.id, schema.processedItems.contentItemId)
    )
    .innerJoin(schema.sources, eq(schema.contentItems.sourceId, schema.sources.id))
    .where(
      and(
        isNull(schema.processedItems.id),
        gte(schema.contentItems.ingestedAt, start),
        lte(schema.contentItems.ingestedAt, end)
      )
    )
    .limit(batchSize);

  if (unprocessedItems.length === 0) {
    return result;
  }

  // Compute fingerprints for items missing them
  const itemsWithFingerprints: {
    item: typeof unprocessedItems[0];
    fingerprint: string;
  }[] = [];

  for (const row of unprocessedItems) {
    const content = row.content.contentText || "";
    let fingerprint = row.content.fingerprint;

    if (!fingerprint && content.length > 0) {
      fingerprint = computeFingerprint(content);
      await db
        .update(schema.contentItems)
        .set({ fingerprint })
        .where(eq(schema.contentItems.id, row.content.id));
    }

    itemsWithFingerprints.push({
      item: row,
      fingerprint: fingerprint || "",
    });
  }

  // Find duplicates by comparing fingerprints within batch
  const duplicateIds = new Set<number>();
  for (let i = 0; i < itemsWithFingerprints.length; i++) {
    if (duplicateIds.has(itemsWithFingerprints[i].item.content.id)) continue;
    if (!itemsWithFingerprints[i].fingerprint) continue;

    for (let j = i + 1; j < itemsWithFingerprints.length; j++) {
      if (!itemsWithFingerprints[j].fingerprint) continue;

      if (
        areFingerprintsSimilar(
          itemsWithFingerprints[i].fingerprint,
          itemsWithFingerprints[j].fingerprint,
          config.fingerprintThreshold
        )
      ) {
        duplicateIds.add(itemsWithFingerprints[j].item.content.id);
        result.duplicatesFound++;
      }
    }
  }

  // Process non-duplicate items
  const processedItemsData: {
    id: number;
    embedding: number[];
    contentItemId: number;
  }[] = [];

  for (const { item, fingerprint } of itemsWithFingerprints) {
    if (duplicateIds.has(item.content.id)) {
      result.itemsSkipped++;
      continue;
    }

    try {
      const content = item.content.contentText || "";
      if (!content || content.length < 50) {
        result.itemsSkipped++;
        continue;
      }

      // Extract content with Claude
      const extraction = await extractContent(content, {
        title: item.content.title,
        author: item.content.author,
        sourceType: item.source.sourceType,
      });

      // Compute embedding
      const embedding = await computeEmbedding(content);

      // Save processed item
      const [inserted] = await db
        .insert(schema.processedItems)
        .values({
          contentItemId: item.content.id,
          summary: extraction.summary,
          keyInformation: extraction.keyInformation,
          themes: extraction.themes,
          hotTakes: extraction.hotTakes,
          entities: extraction.entities,
          embedding,
        })
        .returning();

      processedItemsData.push({
        id: inserted.id,
        embedding,
        contentItemId: item.content.id,
      });

      result.itemsProcessed++;
    } catch (error) {
      result.itemsFailed++;
      result.errors.push(
        `Failed to process item ${item.content.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // Check novelty for processed items
  if (processedItemsData.length > 0) {
    const noveltyResults = await batchCheckNovelty(processedItemsData);

    for (const [itemId, novelty] of noveltyResults) {
      if (novelty.isFollowup) {
        // Update key information to mark as follow-up
        await db
          .update(schema.processedItems)
          .set({
            keyInformation: sql`array_prepend('[Follow-up story]', ${schema.processedItems.keyInformation})`,
          })
          .where(eq(schema.processedItems.id, itemId));
      }
    }
  }

  // Cluster items if we have enough
  if (processedItemsData.length >= 2) {
    const embeddings = processedItemsData.map((p) => p.embedding);
    let clusterResult = clusterItems(embeddings, config.semanticThreshold);

    // Merge similar clusters
    clusterResult = mergeClusters(clusterResult, embeddings, 0.9);

    // Save clusters
    for (const cluster of clusterResult.clusters) {
      const representativeProcessedItem =
        processedItemsData[cluster.representativeIdx];

      const [storyCluster] = await db
        .insert(schema.storyClusters)
        .values({
          weekNumber: currentWeek,
          canonicalItemId: representativeProcessedItem.id,
        })
        .returning();

      // Save cluster members
      for (const idx of cluster.indices) {
        const processedItem = processedItemsData[idx];
        const similarity = idx === cluster.representativeIdx ? 1.0 : 0.85;

        await db.insert(schema.clusterMembers).values({
          clusterId: storyCluster.id,
          processedItemId: processedItem.id,
          similarityScore: similarity,
        });
      }

      result.clustersCreated++;
    }
  }

  return result;
}

export async function reprocessAll(): Promise<ProcessingResult> {
  // Delete existing processed data
  await db.delete(schema.clusterMembers);
  await db.delete(schema.storyClusters);
  await db.delete(schema.processedItems);

  // Process all items in batches
  const totalResult: ProcessingResult = {
    itemsProcessed: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    duplicatesFound: 0,
    clustersCreated: 0,
    errors: [],
  };

  let hasMore = true;
  while (hasMore) {
    const batchResult = await processNewItems(undefined, 100);

    totalResult.itemsProcessed += batchResult.itemsProcessed;
    totalResult.itemsSkipped += batchResult.itemsSkipped;
    totalResult.itemsFailed += batchResult.itemsFailed;
    totalResult.duplicatesFound += batchResult.duplicatesFound;
    totalResult.clustersCreated += batchResult.clustersCreated;
    totalResult.errors.push(...batchResult.errors);

    hasMore = batchResult.itemsProcessed > 0 || batchResult.itemsSkipped > 0;
  }

  return totalResult;
}

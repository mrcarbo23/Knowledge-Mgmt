import { db } from "@/lib/db";
import {
  contentItems,
  processedItems,
  sources,
  storyClusters,
  clusterMembers,
} from "@/lib/db/schema";
import { config } from "@/lib/config";
import { getWeekNumber } from "@/lib/utils";
import { computeFingerprint, areFingerprintsSimilar } from "./fingerprint";
import { computeEmbedding } from "./embeddings";
import { extractContent } from "./extractor";
import { clusterItems } from "./clustering";
import { batchCheckNovelty } from "./novelty";
import { eq, isNull, sql } from "drizzle-orm";

export interface ProcessingResult {
  itemsProcessed: number;
  itemsSkipped: number;
  itemsFailed: number;
  duplicatesFound: number;
  clustersCreated: number;
  errors: string[];
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

  const currentWeek = weekNumber ?? getWeekNumber();

  // Get unprocessed items (LEFT JOIN where processed is NULL)
  const unprocessed = await db
    .select({
      id: contentItems.id,
      sourceId: contentItems.sourceId,
      title: contentItems.title,
      author: contentItems.author,
      contentText: contentItems.contentText,
      fingerprint: contentItems.fingerprint,
    })
    .from(contentItems)
    .leftJoin(
      processedItems,
      eq(contentItems.id, processedItems.contentItemId)
    )
    .where(isNull(processedItems.id))
    .limit(batchSize);

  if (unprocessed.length === 0) {
    return result;
  }

  // Step 1: Compute fingerprints
  for (const item of unprocessed) {
    if (item.contentText && !item.fingerprint) {
      const fp = computeFingerprint(item.contentText);
      await db
        .update(contentItems)
        .set({ fingerprint: fp })
        .where(eq(contentItems.id, item.id));
      item.fingerprint = fp;
    }
  }

  // Step 2: Find duplicates
  const skipIds = new Set<number>();
  const dupGroups: number[][] = [];
  const processed = new Set<number>();

  for (let i = 0; i < unprocessed.length; i++) {
    const item1 = unprocessed[i];
    if (processed.has(item1.id) || !item1.fingerprint) continue;

    const group = [item1.id];
    processed.add(item1.id);

    for (let j = i + 1; j < unprocessed.length; j++) {
      const item2 = unprocessed[j];
      if (processed.has(item2.id) || !item2.fingerprint) continue;

      const similar = areFingerprintsSimilar(
        item1.fingerprint,
        item2.fingerprint,
        config.fingerprintThreshold
      );

      if (similar) {
        group.push(item2.id);
        processed.add(item2.id);
      }
    }

    if (group.length > 1) {
      dupGroups.push(group);
      // Skip all but the first
      for (let k = 1; k < group.length; k++) {
        skipIds.add(group[k]);
      }
    }
  }

  result.duplicatesFound = dupGroups.length;
  result.itemsSkipped = skipIds.size;

  // Step 3: Process each item
  const itemsToProcess = unprocessed.filter((i) => !skipIds.has(i.id));
  const processedItemsList: Array<{
    id: number;
    embedding: number[];
    contentItemId: number;
  }> = [];

  for (const item of itemsToProcess) {
    try {
      // Get source type
      const [source] = await db
        .select({ sourceType: sources.sourceType })
        .from(sources)
        .where(eq(sources.id, item.sourceId))
        .limit(1);

      // Extract with Claude
      const extraction = await extractContent(
        item.contentText ?? "",
        item.title ?? undefined,
        item.author ?? undefined,
        source?.sourceType
      );

      // Compute embedding
      const embedding = await computeEmbedding(extraction.summary);

      // Save processed item
      const [inserted] = await db
        .insert(processedItems)
        .values({
          contentItemId: item.id,
          summary: extraction.summary,
          keyInformation: extraction.keyInformation,
          themes: extraction.themes,
          hotTakes: extraction.hotTakes,
          entities: extraction.entities,
          embedding,
        })
        .returning({ id: processedItems.id });

      processedItemsList.push({
        id: inserted.id,
        embedding,
        contentItemId: item.id,
      });
      result.itemsProcessed++;
    } catch (e) {
      result.itemsFailed++;
      result.errors.push(`Failed to process ${item.title}: ${e}`);
    }
  }

  // Step 4: Check novelty
  if (processedItemsList.length > 0) {
    try {
      const noveltyResults = await batchCheckNovelty(
        processedItemsList.map((p) => ({ id: p.id, embedding: p.embedding }))
      );

      for (const [itemId, novelty] of noveltyResults) {
        if (novelty.isFollowup) {
          // Append follow-up marker to key_information
          const item = processedItemsList.find((p) => p.id === itemId);
          if (item) {
            await db
              .update(processedItems)
              .set({
                keyInformation: sql`COALESCE(${processedItems.keyInformation}, '[]'::jsonb) || '["[Follow-up story]"]'::jsonb`,
              })
              .where(eq(processedItems.id, itemId));
          }
        }
      }
    } catch (e) {
      result.errors.push(`Novelty check failed: ${e}`);
    }
  }

  // Step 5: Create clusters
  if (processedItemsList.length >= 2) {
    try {
      const embeddings = processedItemsList.map((p) => p.embedding);
      const clusteringResult = clusterItems(embeddings, 2);

      for (const cluster of clusteringResult.clusters) {
        if (cluster.itemIndices.length < 2) continue;

        const canonicalIdx = cluster.representativeIdx;
        const canonicalItem = processedItemsList[canonicalIdx];

        const [insertedCluster] = await db
          .insert(storyClusters)
          .values({
            weekNumber: currentWeek,
            canonicalItemId: canonicalItem.id,
          })
          .returning({ id: storyClusters.id });

        for (const idx of cluster.itemIndices) {
          const pi = processedItemsList[idx];
          await db.insert(clusterMembers).values({
            clusterId: insertedCluster.id,
            processedItemId: pi.id,
            similarityScore: idx === canonicalIdx ? 1.0 : 0.9,
          });
        }

        result.clustersCreated++;
      }
    } catch (e) {
      result.errors.push(`Clustering failed: ${e}`);
    }
  }

  return result;
}

export async function reprocessAll(
  weekNumber?: string
): Promise<ProcessingResult> {
  // Delete in correct order
  await db.delete(clusterMembers);
  await db.delete(storyClusters);
  await db.delete(processedItems);

  return processNewItems(weekNumber, 100);
}

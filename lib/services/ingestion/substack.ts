import Parser from "rss-parser";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export interface IngestResult {
  sourceId: number;
  itemsFound: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsFailed: number;
  errors: string[];
}

interface SubstackConfig {
  feedUrl: string;
}

const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "dcCreator"],
    ],
  },
});

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestSubstack(
  sourceId: number,
  config: SubstackConfig,
  force = false
): Promise<IngestResult> {
  const result: IngestResult = {
    sourceId,
    itemsFound: 0,
    itemsNew: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    errors: [],
  };

  try {
    const feed = await parser.parseURL(config.feedUrl);
    result.itemsFound = feed.items.length;

    for (const item of feed.items) {
      try {
        // Generate external ID
        const externalId =
          item.guid ||
          crypto.createHash("sha256").update(item.link || "").digest("hex");

        // Check if exists
        const existing = await db
          .select()
          .from(schema.contentItems)
          .where(
            and(
              eq(schema.contentItems.sourceId, sourceId),
              eq(schema.contentItems.externalId, externalId)
            )
          )
          .limit(1);

        if (existing.length > 0 && !force) {
          result.itemsSkipped++;
          continue;
        }

        // Extract content
        const contentHtml =
          (item as Record<string, unknown>).contentEncoded?.toString() ||
          item.content ||
          item.summary ||
          "";
        const contentText = htmlToText(contentHtml);
        const author =
          (item as Record<string, unknown>).dcCreator?.toString() ||
          item.creator ||
          feed.title ||
          "";

        // Parse published date
        let publishedAt: Date | null = null;
        if (item.pubDate) {
          publishedAt = new Date(item.pubDate);
        } else if (item.isoDate) {
          publishedAt = new Date(item.isoDate);
        }

        if (existing.length > 0 && force) {
          // Update existing
          await db
            .update(schema.contentItems)
            .set({
              title: item.title || null,
              author,
              contentText,
              contentHtml,
              url: item.link || null,
              publishedAt,
            })
            .where(eq(schema.contentItems.id, existing[0].id));
          result.itemsNew++;
        } else {
          // Insert new
          await db.insert(schema.contentItems).values({
            sourceId,
            externalId,
            title: item.title || null,
            author,
            contentText,
            contentHtml,
            url: item.link || null,
            publishedAt,
          });
          result.itemsNew++;
        }
      } catch (error) {
        result.itemsFailed++;
        result.errors.push(
          `Failed to process item ${item.title}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `Failed to fetch feed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  return result;
}

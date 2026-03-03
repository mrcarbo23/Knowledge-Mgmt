import Parser from "rss-parser";
import { htmlToText } from "@/lib/utils";
import { db } from "@/lib/db";
import { contentItems, sources } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";

interface IngestResult {
  sourceId: number;
  itemsFound: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsFailed: number;
  errors: string[];
}

function normalizeSubstackUrl(url: string): string {
  // Remove trailing slash
  let normalized = url.replace(/\/+$/, "");
  
  // If it's already a feed URL, return as-is
  if (normalized.endsWith("/feed")) {
    return normalized;
  }
  
  // Handle various Substack URL formats
  try {
    const parsed = new URL(normalized);
    
    // If it's a substack.com/@username or substack.com/@username/p-xxx URL
    // Convert to the proper subdomain feed
    if (parsed.hostname === "substack.com" && parsed.pathname.startsWith("/@")) {
      const username = parsed.pathname.split("/")[1].replace("@", "");
      return `https://${username}.substack.com/feed`;
    }
    
    // If it's already a subdomain (e.g., example.substack.com or custom domain)
    // Just append /feed
    return `${parsed.origin}/feed`;
  } catch {
    // If URL parsing fails, just append /feed
    return `${normalized}/feed`;
  }
}

export async function ingestSubstack(
  sourceId: number,
  sourceConfig: { url: string },
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

  if (!sourceConfig.url) {
    result.errors.push("Substack source requires 'url' in config");
    return result;
  }

  const parser = new Parser();
  const feedUrl = normalizeSubstackUrl(sourceConfig.url);

  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (e) {
    result.errors.push(`Failed to fetch feed from ${feedUrl}: ${e}`);
    return result;
  }

  const items = feed.items ?? [];
  result.itemsFound = items.length;

  for (const entry of items) {
    try {
      const externalId =
        entry.guid ||
        entry.id ||
        createHash("sha256")
          .update(entry.link ?? "")
          .digest("hex")
          .slice(0, 64);

      const title = entry.title ?? "Untitled";
      const author = entry.creator ?? entry["dc:creator"] ?? null;
      const contentHtml =
        entry["content:encoded"] ?? entry.content ?? entry.summary ?? null;
      const contentText = contentHtml ? htmlToText(contentHtml) : null;
      const url = entry.link ?? null;
      const publishedAt = entry.pubDate ? new Date(entry.pubDate) : null;

      // Check if exists
      const existing = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(
          and(
            eq(contentItems.sourceId, sourceId),
            eq(contentItems.externalId, externalId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        if (force) {
          await db
            .update(contentItems)
            .set({
              title,
              author,
              contentText,
              contentHtml,
              url,
              publishedAt,
            })
            .where(eq(contentItems.id, existing[0].id));
          result.itemsSkipped++; // count as skip since it already existed
        } else {
          result.itemsSkipped++;
        }
        continue;
      }

      await db.insert(contentItems).values({
        sourceId,
        externalId,
        title,
        author,
        contentText,
        contentHtml,
        url,
        publishedAt,
      });
      result.itemsNew++;
    } catch (e) {
      result.itemsFailed++;
      result.errors.push(`Failed to store ${entry.title}: ${e}`);
    }
  }

  return result;
}

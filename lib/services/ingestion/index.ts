import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ingestSubstack, type IngestResult } from "./substack";
import { ingestYouTube } from "./youtube";
import { ingestGmail } from "./gmail";

export type { IngestResult };
export { getGmailAuthUrl, handleGmailCallback } from "./gmail";

export async function ingestAllSources(): Promise<{
  results: IngestResult[];
  errors: string[];
}> {
  const results: IngestResult[] = [];
  const errors: string[] = [];

  // Get all active sources
  const sources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.active, true));

  for (const source of sources) {
    try {
      let result: IngestResult;

      switch (source.sourceType) {
        case "substack":
          result = await ingestSubstack(
            source.id,
            source.config as { feedUrl: string }
          );
          break;
        case "youtube":
          result = await ingestYouTube(
            source.id,
            source.config as {
              channelId?: string;
              channelUrl?: string;
              playlistId?: string;
              playlistUrl?: string;
              videoUrls?: string[];
              videoIds?: string[];
              maxVideos?: number;
            }
          );
          break;
        case "gmail":
          result = await ingestGmail(
            source.id,
            source.config as {
              label?: string;
              senders?: string[];
              daysBack?: number;
            }
          );
          break;
        default:
          errors.push(`Unknown source type: ${source.sourceType}`);
          continue;
      }

      results.push(result);

      // Update source timestamp
      await db
        .update(schema.sources)
        .set({ updatedAt: new Date() })
        .where(eq(schema.sources.id, source.id));
    } catch (error) {
      errors.push(
        `Failed to ingest source ${source.name}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return { results, errors };
}

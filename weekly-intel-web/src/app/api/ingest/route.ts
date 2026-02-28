import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sources, jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ingestSubstack } from "@/lib/services/ingestion/substack";
import { ingestYouTube } from "@/lib/services/ingestion/youtube";
import { ingestGmail } from "@/lib/services/ingestion/gmail";

export async function POST() {
  // Create job run
  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "ingest", status: "running" })
    .returning();

  try {
    // Get all active sources
    const activeSources = await db
      .select()
      .from(sources)
      .where(eq(sources.active, true));

    const results: Record<string, unknown>[] = [];

    for (const source of activeSources) {
      const config = source.config as Record<string, unknown>;
      let result;

      switch (source.sourceType) {
        case "substack":
          result = await ingestSubstack(
            source.id,
            config as { url: string }
          );
          break;
        case "youtube":
          result = await ingestYouTube(source.id, config);
          break;
        case "gmail":
          result = await ingestGmail(source.id, config);
          break;
        default:
          result = { error: `Unknown source type: ${source.sourceType}` };
      }

      results.push({ source: source.name, ...result });
    }

    // Update job
    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: results,
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ jobId: job.id, results });
  } catch (e) {
    await db
      .update(jobRuns)
      .set({
        status: "failed",
        error: String(e),
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

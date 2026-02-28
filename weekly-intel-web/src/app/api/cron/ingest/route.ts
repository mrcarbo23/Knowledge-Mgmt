import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { sources, jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ingestSubstack } from "@/lib/services/ingestion/substack";
import { ingestYouTube } from "@/lib/services/ingestion/youtube";
import { ingestGmail } from "@/lib/services/ingestion/gmail";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "ingest", status: "running" })
    .returning();

  try {
    const activeSources = await db
      .select()
      .from(sources)
      .where(eq(sources.active, true));

    const results: Record<string, unknown>[] = [];

    for (const source of activeSources) {
      const sourceConfig = source.config as Record<string, unknown>;
      let result;

      switch (source.sourceType) {
        case "substack":
          result = await ingestSubstack(
            source.id,
            sourceConfig as { url: string }
          );
          break;
        case "youtube":
          result = await ingestYouTube(source.id, sourceConfig);
          break;
        case "gmail":
          result = await ingestGmail(source.id, sourceConfig);
          break;
        default:
          result = { error: `Unknown type: ${source.sourceType}` };
      }

      results.push({ source: source.name, ...result });
    }

    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: results,
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ ok: true, results });
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

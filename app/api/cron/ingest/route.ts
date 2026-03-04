import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ingestAllSources } from "@/lib/services/ingestion";
import { config } from "@/lib/config";

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = config.cronSecret();

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Create job run record
  const [job] = await db
    .insert(schema.jobRuns)
    .values({
      jobType: "ingest",
      status: "running",
    })
    .returning();

  try {
    const { results, errors } = await ingestAllSources();

    const totalNew = results.reduce((sum, r) => sum + r.itemsNew, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.itemsSkipped, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.itemsFailed, 0);

    // Update job as completed
    await db
      .update(schema.jobRuns)
      .set({
        status: "completed",
        result: {
          sourcesProcessed: results.length,
          itemsNew: totalNew,
          itemsSkipped: totalSkipped,
          itemsFailed: totalFailed,
          errors,
        },
        completedAt: new Date(),
      })
      .where(eq(schema.jobRuns.id, job.id));

    return NextResponse.json({
      success: true,
      jobId: job.id,
      results: {
        sourcesProcessed: results.length,
        itemsNew: totalNew,
        itemsSkipped: totalSkipped,
        itemsFailed: totalFailed,
      },
    });
  } catch (error) {
    // Update job as failed
    await db
      .update(schema.jobRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(schema.jobRuns.id, job.id));

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cron ingestion failed",
      },
      { status: 500 }
    );
  }
}

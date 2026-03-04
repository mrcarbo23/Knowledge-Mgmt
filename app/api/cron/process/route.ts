import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { processNewItems } from "@/lib/services/processing/pipeline";
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
      jobType: "process",
      status: "running",
    })
    .returning();

  try {
    const result = await processNewItems(undefined, 50);

    // Update job as completed
    await db
      .update(schema.jobRuns)
      .set({
        status: "completed",
        result: {
          itemsProcessed: result.itemsProcessed,
          itemsSkipped: result.itemsSkipped,
          itemsFailed: result.itemsFailed,
          duplicatesFound: result.duplicatesFound,
          clustersCreated: result.clustersCreated,
          errors: result.errors,
        },
        completedAt: new Date(),
      })
      .where(eq(schema.jobRuns.id, job.id));

    return NextResponse.json({
      success: true,
      jobId: job.id,
      ...result,
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
        error: error instanceof Error ? error.message : "Cron processing failed",
      },
      { status: 500 }
    );
  }
}

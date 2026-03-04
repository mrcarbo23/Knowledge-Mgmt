import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { processNewItems } from "@/lib/services/processing/pipeline";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const batchSize = body.batchSize || 10;
  const weekNumber = body.weekNumber;

  // Create job run record
  const [job] = await db
    .insert(schema.jobRuns)
    .values({
      jobType: "process",
      status: "running",
    })
    .returning();

  try {
    const result = await processNewItems(weekNumber, batchSize);

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
        jobId: job.id,
        error: error instanceof Error ? error.message : "Processing failed",
      },
      { status: 500 }
    );
  }
}

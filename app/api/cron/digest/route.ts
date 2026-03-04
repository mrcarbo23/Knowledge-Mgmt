import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateDigest, saveDigest } from "@/lib/services/digest";
import { sendDigestToAll } from "@/lib/services/delivery/email";
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
      jobType: "digest",
      status: "running",
    })
    .returning();

  try {
    // Generate digest
    const content = await generateDigest();
    const { id } = await saveDigest(content);

    // Send to all recipients
    const emailResult = await sendDigestToAll(id);

    // Update job as completed
    await db
      .update(schema.jobRuns)
      .set({
        status: "completed",
        result: {
          digestId: id,
          weekNumber: content.weekNumber,
          themesCount: content.themes.length,
          sourcesCount: content.sourceIndex.length,
          emailsSent: emailResult.sent,
          emailsFailed: emailResult.failed,
          emailErrors: emailResult.errors,
        },
        completedAt: new Date(),
      })
      .where(eq(schema.jobRuns.id, job.id));

    return NextResponse.json({
      success: true,
      jobId: job.id,
      digestId: id,
      weekNumber: content.weekNumber,
      emailsSent: emailResult.sent,
      emailsFailed: emailResult.failed,
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
        error: error instanceof Error ? error.message : "Cron digest failed",
      },
      { status: 500 }
    );
  }
}

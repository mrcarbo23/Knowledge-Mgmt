import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { generateDigest, saveDigest } from "@/lib/services/digest";
import { sendDigestToAll } from "@/lib/services/delivery/email";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekNumber = searchParams.get("weekNumber");

    if (weekNumber) {
      const digest = await db
        .select()
        .from(schema.weeklyDigests)
        .where(eq(schema.weeklyDigests.weekNumber, weekNumber))
        .limit(1);

      if (digest.length === 0) {
        return NextResponse.json({ error: "Digest not found" }, { status: 404 });
      }

      return NextResponse.json({ digest: digest[0] });
    }

    const digests = await db
      .select()
      .from(schema.weeklyDigests)
      .orderBy(desc(schema.weeklyDigests.generatedAt));

    return NextResponse.json({ digests });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch digests" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, weekNumber, digestId } = body;

    // Send existing digest
    if (action === "send" && digestId) {
      const result = await sendDigestToAll(digestId);
      return NextResponse.json({
        success: true,
        ...result,
      });
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
      // Generate new digest
      const content = await generateDigest(weekNumber);
      const { id } = await saveDigest(content);

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
          },
          completedAt: new Date(),
        })
        .where(eq(schema.jobRuns.id, job.id));

      return NextResponse.json({
        success: true,
        jobId: job.id,
        digestId: id,
        weekNumber: content.weekNumber,
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

      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate digest" },
      { status: 500 }
    );
  }
}

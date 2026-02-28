import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processNewItems } from "@/lib/services/processing/pipeline";

export async function POST() {
  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "process", status: "running" })
    .returning();

  try {
    const result = await processNewItems(undefined, 10);

    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ jobId: job.id, result });
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

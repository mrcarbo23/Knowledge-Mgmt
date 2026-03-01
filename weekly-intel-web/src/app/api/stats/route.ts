import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sources,
  contentItems,
  processedItems,
  weeklyDigests,
  jobRuns,
} from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sourceCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sources);

    const [contentCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contentItems);

    const [processedCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(processedItems);

    const [digestCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(weeklyDigests);

    const recentJobs = await db
      .select({
        id: jobRuns.id,
        jobType: jobRuns.jobType,
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(10);

    return NextResponse.json({
      sources: Number(sourceCount.count),
      contentItems: Number(contentCount.count),
      processedItems: Number(processedCount.count),
      digests: Number(digestCount.count),
      recentJobs,
    });
  } catch (e) {
    console.error("Stats API error:", e);
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}

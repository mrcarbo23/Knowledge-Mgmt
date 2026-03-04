import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get counts using raw SQL for efficiency
    const [sourcesCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sources);

    const [contentCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.contentItems);

    const [processedCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.processedItems);

    const [digestsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.weeklyDigests);

    // Get recent jobs
    const recentJobs = await db
      .select()
      .from(schema.jobRuns)
      .orderBy(desc(schema.jobRuns.startedAt))
      .limit(10);

    return NextResponse.json({
      stats: {
        sources: sourcesCount?.count || 0,
        contentItems: contentCount?.count || 0,
        processedItems: processedCount?.count || 0,
        digests: digestsCount?.count || 0,
      },
      recentJobs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

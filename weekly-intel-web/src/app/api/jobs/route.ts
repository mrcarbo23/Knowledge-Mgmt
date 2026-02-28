import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await db
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(50);

  return NextResponse.json(jobs);
}

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processNewItems } from "@/lib/services/processing/pipeline";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "process", status: "running" })
    .returning();

  try {
    const result = await processNewItems(undefined, 20);

    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ ok: true, result });
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

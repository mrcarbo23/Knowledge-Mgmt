import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { weeklyDigests, jobRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  generateDigest,
  saveDigest,
} from "@/lib/services/digest/generator";
import { sendDigestToAll } from "@/lib/services/delivery/email";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const weekNumber = searchParams.get("weekNumber");

  if (weekNumber) {
    const [digest] = await db
      .select()
      .from(weeklyDigests)
      .where(eq(weeklyDigests.weekNumber, weekNumber))
      .limit(1);

    if (!digest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(digest);
  }

  const digests = await db
    .select({
      id: weeklyDigests.id,
      weekNumber: weeklyDigests.weekNumber,
      dateRange: weeklyDigests.dateRange,
      sourcesCount: weeklyDigests.sourcesCount,
      itemsCount: weeklyDigests.itemsCount,
      generatedAt: weeklyDigests.generatedAt,
    })
    .from(weeklyDigests)
    .orderBy(desc(weeklyDigests.weekNumber));

  return NextResponse.json(digests);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const weekNumber = body.weekNumber as string | undefined;
  const action = body.action as string | undefined;

  // If action is "send", send existing digest via email
  if (action === "send" && weekNumber) {
    const [digest] = await db
      .select()
      .from(weeklyDigests)
      .where(eq(weeklyDigests.weekNumber, weekNumber))
      .limit(1);

    if (!digest || !digest.digestData) {
      return NextResponse.json(
        { error: "Digest not found" },
        { status: 404 }
      );
    }

    const digestContent = digest.digestData as unknown as Parameters<
      typeof sendDigestToAll
    >[0];
    digestContent.generatedAt = new Date(digest.generatedAt!);
    const results = await sendDigestToAll(digestContent, undefined, digest.id);
    return NextResponse.json({ results });
  }

  // Otherwise, generate a new digest
  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "digest", status: "running" })
    .returning();

  try {
    const content = await generateDigest(weekNumber);
    const digestId = await saveDigest(content);

    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: {
          digestId,
          weekNumber: content.weekNumber,
          themes: content.themes.length,
          items: content.itemsCount,
        },
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({
      jobId: job.id,
      digestId,
      weekNumber: content.weekNumber,
    });
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

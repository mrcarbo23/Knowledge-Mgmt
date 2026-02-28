import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDigest, saveDigest } from "@/lib/services/digest/generator";
import { sendDigestToAll } from "@/lib/services/delivery/email";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [job] = await db
    .insert(jobRuns)
    .values({ jobType: "digest", status: "running" })
    .returning();

  try {
    const content = await generateDigest();
    const digestId = await saveDigest(content);

    // Auto-send if recipients configured
    let emailResults: unknown[] = [];
    if (config.emailRecipients.length > 0 && config.resendApiKey) {
      emailResults = await sendDigestToAll(content, undefined, digestId);
    }

    await db
      .update(jobRuns)
      .set({
        status: "completed",
        result: {
          digestId,
          weekNumber: content.weekNumber,
          themes: content.themes.length,
          items: content.itemsCount,
          emailsSent: emailResults.length,
        },
        completedAt: new Date(),
      })
      .where(eq(jobRuns.id, job.id));

    return NextResponse.json({ ok: true, digestId });
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

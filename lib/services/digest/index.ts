import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateDigest, type DigestContent } from "./generator";
import { renderMarkdown, renderHtml, renderPlainText } from "./renderer";

export { generateDigest, type DigestContent };
export { renderMarkdown, renderHtml, renderPlainText };

export async function saveDigest(
  content: DigestContent
): Promise<{ id: number }> {
  const markdown = renderMarkdown(content);
  const html = renderHtml(content);

  // Check if digest for this week exists
  const existing = await db
    .select()
    .from(schema.weeklyDigests)
    .where(eq(schema.weeklyDigests.weekNumber, content.weekNumber))
    .limit(1);

  if (existing.length > 0) {
    // Update existing
    await db
      .update(schema.weeklyDigests)
      .set({
        dateRange: content.dateRange,
        sourcesCount: content.sourceIndex.length,
        itemsCount: content.themes.reduce((sum, t) => sum + t.items.length, 0),
        markdownContent: markdown,
        htmlContent: html,
        digestData: content,
        generatedAt: new Date(),
      })
      .where(eq(schema.weeklyDigests.id, existing[0].id));

    return { id: existing[0].id };
  }

  // Insert new
  const [inserted] = await db
    .insert(schema.weeklyDigests)
    .values({
      weekNumber: content.weekNumber,
      dateRange: content.dateRange,
      sourcesCount: content.sourceIndex.length,
      itemsCount: content.themes.reduce((sum, t) => sum + t.items.length, 0),
      markdownContent: markdown,
      htmlContent: html,
      digestData: content,
    })
    .returning();

  return { id: inserted.id };
}

export async function getDigest(
  weekNumber: string
): Promise<{ digest: typeof schema.weeklyDigests.$inferSelect | null }> {
  const result = await db
    .select()
    .from(schema.weeklyDigests)
    .where(eq(schema.weeklyDigests.weekNumber, weekNumber))
    .limit(1);

  return { digest: result[0] || null };
}

export async function listDigests() {
  return db
    .select()
    .from(schema.weeklyDigests)
    .orderBy(schema.weeklyDigests.generatedAt);
}

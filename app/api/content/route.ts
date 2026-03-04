import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = db
      .select({
        content: schema.contentItems,
        source: schema.sources,
        processed: schema.processedItems,
      })
      .from(schema.contentItems)
      .leftJoin(schema.sources, eq(schema.contentItems.sourceId, schema.sources.id))
      .leftJoin(
        schema.processedItems,
        eq(schema.contentItems.id, schema.processedItems.contentItemId)
      )
      .orderBy(desc(schema.contentItems.ingestedAt))
      .limit(limit);

    if (sourceId) {
      const parsedSourceId = parseInt(sourceId, 10);
      if (!isNaN(parsedSourceId)) {
        query = query.where(eq(schema.contentItems.sourceId, parsedSourceId)) as typeof query;
      }
    }

    const results = await query;

    const items = results.map((row) => ({
      id: row.content.id,
      title: row.content.title,
      author: row.content.author,
      url: row.content.url,
      publishedAt: row.content.publishedAt,
      ingestedAt: row.content.ingestedAt,
      source: row.source
        ? { id: row.source.id, name: row.source.name, type: row.source.sourceType }
        : null,
      isProcessed: !!row.processed,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch content" },
      { status: 500 }
    );
  }
}

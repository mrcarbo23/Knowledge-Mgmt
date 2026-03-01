import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentItems, processedItems, sources } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") ?? "100", 10);

  const rows = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      author: contentItems.author,
      url: contentItems.url,
      publishedAt: contentItems.publishedAt,
      ingestedAt: contentItems.ingestedAt,
      sourceName: sources.name,
      sourceType: sources.sourceType,
      processedItemId: processedItems.id,
    })
    .from(contentItems)
    .innerJoin(sources, eq(contentItems.sourceId, sources.id))
    .leftJoin(processedItems, eq(contentItems.id, processedItems.contentItemId))
    .orderBy(desc(contentItems.ingestedAt))
    .limit(limit);

  const result = rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    url: row.url,
    publishedAt: row.publishedAt,
    ingestedAt: row.ingestedAt,
    sourceName: row.sourceName,
    sourceType: row.sourceType,
    isProcessed: row.processedItemId !== null,
  }));

  // Filter by status if requested
  if (status === "processed") {
    return NextResponse.json(result.filter((r) => r.isProcessed));
  } else if (status === "unprocessed") {
    return NextResponse.json(result.filter((r) => !r.isProcessed));
  }

  return NextResponse.json(result);
}

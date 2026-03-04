import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sourceId = parseInt(id, 10);

    if (isNaN(sourceId)) {
      return NextResponse.json({ error: "Invalid source ID" }, { status: 400 });
    }

    const sources = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .limit(1);

    if (sources.length === 0) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ source: sources[0] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch source" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sourceId = parseInt(id, 10);

    if (isNaN(sourceId)) {
      return NextResponse.json({ error: "Invalid source ID" }, { status: 400 });
    }

    const body = await request.json();
    const updates: Partial<{
      name: string;
      active: boolean;
      config: Record<string, unknown>;
    }> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.active !== undefined) updates.active = body.active;
    if (body.config !== undefined) updates.config = body.config;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(schema.sources)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.sources.id, sourceId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ source: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update source" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sourceId = parseInt(id, 10);

    if (isNaN(sourceId)) {
      return NextResponse.json({ error: "Invalid source ID" }, { status: 400 });
    }

    const deleted = await db
      .delete(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete source" },
      { status: 500 }
    );
  }
}

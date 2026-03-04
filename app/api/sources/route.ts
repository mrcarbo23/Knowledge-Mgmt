import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sources = await db.select().from(schema.sources);
    return NextResponse.json({ sources });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sources" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, sourceType, config } = body;

    if (!name || !sourceType) {
      return NextResponse.json(
        { error: "Name and sourceType are required" },
        { status: 400 }
      );
    }

    if (!["substack", "youtube", "gmail"].includes(sourceType)) {
      return NextResponse.json(
        { error: "Invalid sourceType. Must be substack, youtube, or gmail" },
        { status: 400 }
      );
    }

    const [source] = await db
      .insert(schema.sources)
      .values({
        name,
        sourceType,
        config: config || {},
      })
      .returning();

    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create source" },
      { status: 500 }
    );
  }
}

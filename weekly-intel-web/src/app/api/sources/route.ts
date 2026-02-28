import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const result = await db
    .select()
    .from(sources)
    .orderBy(desc(sources.createdAt));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const [inserted] = await db
    .insert(sources)
    .values({
      name: body.name,
      sourceType: body.sourceType,
      config: body.config ?? {},
      active: true,
    })
    .returning();

  return NextResponse.json(inserted, { status: 201 });
}

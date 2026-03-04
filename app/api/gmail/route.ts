import { NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/services/ingestion/gmail";

export async function GET() {
  try {
    const authUrl = getGmailAuthUrl();
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/services/ingestion/gmail";

export async function GET() {
  try {
    const authUrl = getGmailAuthUrl();
    return NextResponse.redirect(authUrl);
  } catch (e) {
    return NextResponse.json(
      { error: `Gmail OAuth setup failed: ${e}` },
      { status: 500 }
    );
  }
}

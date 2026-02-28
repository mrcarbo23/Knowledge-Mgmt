import { NextRequest, NextResponse } from "next/server";
import { handleGmailCallback } from "@/lib/services/ingestion/gmail";
import { config } from "@/lib/config";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${config.appUrl}/sources?gmail_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${config.appUrl}/sources?gmail_error=no_code`
    );
  }

  try {
    await handleGmailCallback(code);
    return NextResponse.redirect(
      `${config.appUrl}/sources?gmail_connected=true`
    );
  } catch (e) {
    return NextResponse.redirect(
      `${config.appUrl}/sources?gmail_error=${encodeURIComponent(String(e))}`
    );
  }
}

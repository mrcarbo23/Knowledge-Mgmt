import { NextResponse } from "next/server";
import { handleGmailCallback } from "@/lib/services/ingestion/gmail";
import { config } from "@/lib/config";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        `${config.appUrl}/sources?error=${encodeURIComponent(error)}`
      );
    }

    if (!code) {
      return NextResponse.redirect(
        `${config.appUrl}/sources?error=${encodeURIComponent("No authorization code received")}`
      );
    }

    await handleGmailCallback(code);

    return NextResponse.redirect(
      `${config.appUrl}/sources?success=${encodeURIComponent("Gmail connected successfully")}`
    );
  } catch (error) {
    return NextResponse.redirect(
      `${config.appUrl}/sources?error=${encodeURIComponent(error instanceof Error ? error.message : "Failed to connect Gmail")}`
    );
  }
}

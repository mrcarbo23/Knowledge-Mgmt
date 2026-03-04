import { google } from "googleapis";
import { db, schema } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { config } from "@/lib/config";

export interface IngestResult {
  sourceId: number;
  itemsFound: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsFailed: number;
  errors: string[];
}

interface GmailConfig {
  label?: string;
  senders?: string[];
  daysBack?: number;
}

function getOAuth2Client() {
  const clientId = config.gmailClientId();
  const clientSecret = config.gmailClientSecret();
  const redirectUri = config.gmailRedirectUri();

  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth credentials not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGmailAuthUrl(): string {
  const oauth2Client = getOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    prompt: "consent",
  });
}

export async function handleGmailCallback(code: string): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  // Store tokens in database
  await db.insert(schema.gmailTokens).values({
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token || null,
    tokenType: tokens.token_type || "Bearer",
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope || null,
  });
}

async function getAuthedClient() {
  const oauth2Client = getOAuth2Client();

  // Get latest token from database
  const tokens = await db
    .select()
    .from(schema.gmailTokens)
    .orderBy(desc(schema.gmailTokens.createdAt))
    .limit(1);

  if (tokens.length === 0) {
    throw new Error("No Gmail tokens found. Please authenticate first.");
  }

  const token = tokens[0];

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    token_type: token.tokenType || "Bearer",
    expiry_date: token.expiresAt?.getTime(),
  });

  // Set up automatic token refresh
  oauth2Client.on("tokens", async (newTokens) => {
    await db
      .update(schema.gmailTokens)
      .set({
        accessToken: newTokens.access_token!,
        expiresAt: newTokens.expiry_date
          ? new Date(newTokens.expiry_date)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.gmailTokens.id, token.id));
  });

  return oauth2Client;
}

function buildQuery(gmailConfig: GmailConfig): string {
  const parts: string[] = [];

  if (gmailConfig.label) {
    parts.push(`label:${gmailConfig.label}`);
  }

  if (gmailConfig.senders && gmailConfig.senders.length > 0) {
    const senderQueries = gmailConfig.senders.map((s) => `from:${s}`);
    parts.push(`(${senderQueries.join(" OR ")})`);
  }

  if (gmailConfig.daysBack) {
    parts.push(`newer_than:${gmailConfig.daysBack}d`);
  }

  return parts.join(" ");
}

function extractBody(
  payload: {
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
      }>;
    }>;
  } | null
): { html: string; text: string } {
  let html = "";
  let text = "";

  if (!payload) return { html, text };

  function processPartRecursively(part: {
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
      }>;
    }>;
  }) {
    if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64url").toString("utf-8");
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      text = Buffer.from(part.body.data, "base64url").toString("utf-8");
    } else if (part.parts) {
      for (const subPart of part.parts) {
        processPartRecursively(subPart);
      }
    }
  }

  processPartRecursively(payload);

  // If only body data directly on payload
  if (!html && !text && payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, "base64url").toString(
      "utf-8"
    );
    if (payload.mimeType === "text/html") {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  return { html, text };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestGmail(
  sourceId: number,
  gmailConfig: GmailConfig,
  force = false
): Promise<IngestResult> {
  const result: IngestResult = {
    sourceId,
    itemsFound: 0,
    itemsNew: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    errors: [],
  };

  try {
    const auth = await getAuthedClient();
    const gmail = google.gmail({ version: "v1", auth });

    const query = buildQuery(gmailConfig);
    let pageToken: string | undefined;
    const messageIds: string[] = [];

    // Paginate through messages
    do {
      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 100,
        pageToken,
      });

      if (listResponse.data.messages) {
        messageIds.push(
          ...listResponse.data.messages.map((m) => m.id!).filter(Boolean)
        );
      }

      pageToken = listResponse.data.nextPageToken || undefined;
    } while (pageToken);

    result.itemsFound = messageIds.length;

    for (const messageId of messageIds) {
      try {
        // Check if exists
        const existing = await db
          .select()
          .from(schema.contentItems)
          .where(
            and(
              eq(schema.contentItems.sourceId, sourceId),
              eq(schema.contentItems.externalId, messageId)
            )
          )
          .limit(1);

        if (existing.length > 0 && !force) {
          result.itemsSkipped++;
          continue;
        }

        // Fetch full message
        const messageResponse = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const message = messageResponse.data;
        const headers = message.payload?.headers || [];

        // Extract headers
        const subject =
          headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const from =
          headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const dateStr =
          headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

        // Parse date
        let publishedAt: Date | null = null;
        if (dateStr) {
          publishedAt = new Date(dateStr);
        } else if (message.internalDate) {
          publishedAt = new Date(parseInt(message.internalDate));
        }

        // Extract body
        const { html, text } = extractBody(message.payload || null);
        const contentText = text || htmlToText(html);

        if (existing.length > 0 && force) {
          await db
            .update(schema.contentItems)
            .set({
              title: subject,
              author: from,
              contentText,
              contentHtml: html,
              publishedAt,
            })
            .where(eq(schema.contentItems.id, existing[0].id));
          result.itemsNew++;
        } else {
          await db.insert(schema.contentItems).values({
            sourceId,
            externalId: messageId,
            title: subject,
            author: from,
            contentText,
            contentHtml: html,
            publishedAt,
          });
          result.itemsNew++;
        }
      } catch (error) {
        result.itemsFailed++;
        result.errors.push(
          `Failed to process message ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `Gmail ingestion failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  return result;
}

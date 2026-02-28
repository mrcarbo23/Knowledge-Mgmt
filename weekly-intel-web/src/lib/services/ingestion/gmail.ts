import { google } from "googleapis";
import { db } from "@/lib/db";
import { contentItems, gmailTokens } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { htmlToText } from "@/lib/utils";
import { eq, and, desc } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

interface IngestResult {
  sourceId: number;
  itemsFound: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsFailed: number;
  errors: string[];
}

interface GmailSourceConfig {
  label?: string;
  senders?: string[];
  daysBack?: number;
  maxResults?: number;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.gmailClientId,
    config.gmailClientSecret,
    config.gmailRedirectUri
  );
}

export function getGmailAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function handleGmailCallback(code: string): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  await db.insert(gmailTokens).values({
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token ?? null,
    tokenType: tokens.token_type ?? "Bearer",
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? null,
  });
}

async function getAuthedClient() {
  const oauth2Client = getOAuth2Client();

  // Get latest token from DB
  const [token] = await db
    .select()
    .from(gmailTokens)
    .orderBy(desc(gmailTokens.createdAt))
    .limit(1);

  if (!token) {
    throw new Error("Gmail not authenticated. Please connect Gmail first.");
  }

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    token_type: token.tokenType ?? "Bearer",
    expiry_date: token.expiresAt?.getTime(),
  });

  // Handle token refresh
  oauth2Client.on("tokens", async (newTokens) => {
    if (newTokens.access_token) {
      await db
        .update(gmailTokens)
        .set({
          accessToken: newTokens.access_token,
          expiresAt: newTokens.expiry_date
            ? new Date(newTokens.expiry_date)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(gmailTokens.id, token.id));
    }
  });

  return oauth2Client;
}

function buildQuery(sourceConfig: GmailSourceConfig): string {
  const parts: string[] = [];

  if (sourceConfig.label) {
    parts.push(`label:${sourceConfig.label}`);
  }

  if (sourceConfig.senders?.length) {
    const senderQuery = sourceConfig.senders
      .map((s) => `from:${s}`)
      .join(" OR ");
    parts.push(
      sourceConfig.senders.length > 1 ? `(${senderQuery})` : senderQuery
    );
  }

  const days = sourceConfig.daysBack ?? 7;
  parts.push(`newer_than:${days}d`);

  return parts.join(" ");
}

function extractBody(payload: {
  mimeType?: string;
  parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
  body?: { data?: string };
}): { html: string | null; text: string | null } {
  let htmlBody: string | null = null;
  let textBody: string | null = null;

  function processPart(part: typeof payload) {
    const mimeType = part.mimeType ?? "";

    if (part.parts) {
      for (const subpart of part.parts as typeof payload[]) {
        processPart(subpart);
      }
    } else if (part.body?.data) {
      const decoded = Buffer.from(part.body.data, "base64url").toString(
        "utf-8"
      );
      if (mimeType === "text/html" && !htmlBody) {
        htmlBody = decoded;
      } else if (mimeType === "text/plain" && !textBody) {
        textBody = decoded;
      }
    }
  }

  processPart(payload);

  if (htmlBody && !textBody) {
    textBody = htmlToText(htmlBody);
  }

  return { html: htmlBody, text: textBody };
}

export async function ingestGmail(
  sourceId: number,
  sourceConfig: GmailSourceConfig,
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

  if (!sourceConfig.label && !sourceConfig.senders?.length) {
    result.errors.push("Gmail source requires 'label' or 'senders' in config");
    return result;
  }

  let oauth2Client;
  try {
    oauth2Client = await getAuthedClient();
  } catch (e) {
    result.errors.push(`Gmail auth error: ${e}`);
    return result;
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const query = buildQuery(sourceConfig);
  const maxResults = sourceConfig.maxResults ?? 50;

  try {
    let pageToken: string | undefined;
    const messages: Array<{ id: string }> = [];

    do {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: Math.min(maxResults, 100),
        pageToken,
      });

      if (res.data.messages) {
        messages.push(
          ...(res.data.messages as Array<{ id: string }>)
        );
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && messages.length < maxResults);

    result.itemsFound = messages.length;

    for (const msgInfo of messages.slice(0, maxResults)) {
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgInfo.id,
          format: "full",
        });

        const headers: Record<string, string> = {};
        for (const h of msg.data.payload?.headers ?? []) {
          if (h.name && h.value) {
            headers[h.name.toLowerCase()] = h.value;
          }
        }

        const externalId = msgInfo.id;
        const title = headers["subject"] ?? "No Subject";
        const author = headers["from"] ?? "Unknown";

        let publishedAt: Date | null = null;
        if (headers["date"]) {
          try {
            publishedAt = new Date(headers["date"]);
          } catch {
            // ignore
          }
        }

        const { html: contentHtml, text: contentText } = extractBody(
          msg.data.payload as Parameters<typeof extractBody>[0]
        );

        // Check if exists
        const existing = await db
          .select({ id: contentItems.id })
          .from(contentItems)
          .where(
            and(
              eq(contentItems.sourceId, sourceId),
              eq(contentItems.externalId, externalId)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          if (force) {
            await db
              .update(contentItems)
              .set({ title, author, contentText, contentHtml, publishedAt })
              .where(eq(contentItems.id, existing[0].id));
          }
          result.itemsSkipped++;
          continue;
        }

        await db.insert(contentItems).values({
          sourceId,
          externalId,
          title,
          author,
          contentText,
          contentHtml,
          publishedAt,
        });
        result.itemsNew++;
      } catch (e) {
        result.itemsFailed++;
        result.errors.push(`Failed to fetch message ${msgInfo.id}: ${e}`);
      }
    }
  } catch (e) {
    result.errors.push(`Gmail API error: ${e}`);
  }

  return result;
}

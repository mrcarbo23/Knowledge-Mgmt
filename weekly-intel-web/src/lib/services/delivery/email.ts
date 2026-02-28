import { Resend } from "resend";
import { db } from "@/lib/db";
import { emailLogs, weeklyDigests } from "@/lib/db/schema";
import { config } from "@/lib/config";
import type { DigestContent } from "../digest/generator";
import { renderHtmlEmail, renderPlainText } from "../digest/html";
import { eq } from "drizzle-orm";

export interface DeliveryResult {
  success: boolean;
  recipient: string;
  messageId?: string;
  error?: string;
  attempts: number;
}

let resendClient: Resend | null = null;

function getClient(): Resend {
  if (!resendClient) {
    resendClient = new Resend(config.resendApiKey);
  }
  return resendClient;
}

async function sendEmailWithRetry(
  to: string,
  subject: string,
  htmlContent: string,
  textContent: string,
  maxAttempts = 3
): Promise<{ id?: string; error?: string }> {
  const client = getClient();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.emails.send({
        from: config.emailFrom,
        to: [to],
        subject,
        html: htmlContent,
        text: textContent,
      });

      if (result.error) {
        if (attempt === maxAttempts) {
          return { error: result.error.message };
        }
        // Wait before retry
        await new Promise((r) =>
          setTimeout(r, Math.pow(2, attempt) * 1000)
        );
        continue;
      }

      return { id: result.data?.id };
    } catch (e) {
      if (attempt === maxAttempts) {
        return { error: String(e) };
      }
      await new Promise((r) =>
        setTimeout(r, Math.pow(2, attempt) * 1000)
      );
    }
  }

  return { error: "Max retry attempts exceeded" };
}

export async function sendDigestEmail(
  content: DigestContent,
  recipient: string,
  digestId?: number
): Promise<DeliveryResult> {
  const subject = `Weekly Intel - Week of ${content.dateRange}`;
  const htmlContent = renderHtmlEmail(content);
  const textContent = renderPlainText(content);

  const { id: messageId, error } = await sendEmailWithRetry(
    recipient,
    subject,
    htmlContent,
    textContent
  );

  const success = !error;

  // Log to DB
  if (digestId) {
    await db.insert(emailLogs).values({
      digestId,
      recipient,
      status: success ? "sent" : "failed",
      providerMessageId: messageId ?? null,
      attempts: error ? 3 : 1,
      lastAttemptAt: new Date(),
      errorMessage: error ?? null,
    });
  }

  return {
    success,
    recipient,
    messageId,
    error,
    attempts: error ? 3 : 1,
  };
}

export async function sendDigestToAll(
  content: DigestContent,
  recipients?: string[],
  digestId?: number
): Promise<DeliveryResult[]> {
  const recipientList = recipients ?? config.emailRecipients;

  if (recipientList.length === 0) {
    return [];
  }

  const results: DeliveryResult[] = [];
  for (const recipient of recipientList) {
    const result = await sendDigestEmail(content, recipient, digestId);
    results.push(result);
  }

  return results;
}

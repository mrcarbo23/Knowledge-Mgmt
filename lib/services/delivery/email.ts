import { Resend } from "resend";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { renderHtml, renderPlainText } from "../digest/renderer";
import type { DigestContent } from "../digest/generator";

let resendClient: Resend | null = null;

function getResend(): Resend {
  const apiKey = config.resendApiKey();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmailWithRetry(
  to: string,
  subject: string,
  html: string,
  text: string,
  maxAttempts = 3
): Promise<SendResult> {
  const resend = getResend();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await resend.emails.send({
        from: config.emailFrom,
        to,
        subject,
        html,
        text,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        success: true,
        messageId: result.data?.id,
      };
    } catch (error) {
      if (attempt === maxAttempts) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }

      // Exponential backoff: 2^attempt seconds
      const waitTime = Math.pow(2, attempt) * 1000;
      await sleep(waitTime);
    }
  }

  return { success: false, error: "Max attempts reached" };
}

export async function sendDigestEmail(
  digestId: number,
  recipient: string
): Promise<SendResult> {
  // Get digest
  const digest = await db
    .select()
    .from(schema.weeklyDigests)
    .where(eq(schema.weeklyDigests.id, digestId))
    .limit(1);

  if (digest.length === 0) {
    return { success: false, error: "Digest not found" };
  }

  const digestData = digest[0].digestData as DigestContent;
  const html = renderHtml(digestData);
  const text = renderPlainText(digestData);
  const subject = `Weekly Intel - ${digest[0].weekNumber}`;

  // Create email log entry
  const [emailLog] = await db
    .insert(schema.emailLogs)
    .values({
      digestId,
      recipient,
      status: "pending",
      attempts: 0,
    })
    .returning();

  // Send email
  const result = await sendEmailWithRetry(recipient, subject, html, text);

  // Update email log
  await db
    .update(schema.emailLogs)
    .set({
      status: result.success ? "sent" : "failed",
      providerMessageId: result.messageId || null,
      attempts: 1,
      lastAttemptAt: new Date(),
      errorMessage: result.error || null,
    })
    .where(eq(schema.emailLogs.id, emailLog.id));

  return result;
}

export async function sendDigestToAll(
  digestId: number
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const recipients = config.emailRecipients();
  const results = { sent: 0, failed: 0, errors: [] as string[] };

  if (recipients.length === 0) {
    results.errors.push("No recipients configured");
    return results;
  }

  for (const recipient of recipients) {
    const result = await sendDigestEmail(digestId, recipient);
    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push(`Failed to send to ${recipient}: ${result.error}`);
    }
  }

  return results;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",

  gmailClientId: process.env.GMAIL_CLIENT_ID ?? "",
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET ?? "",
  gmailRedirectUri:
    process.env.GMAIL_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/gmail/callback`,

  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingDimension: 1536,

  fingerprintThreshold: parseFloat(
    process.env.FINGERPRINT_THRESHOLD ?? "0.8"
  ),
  semanticThreshold: parseFloat(process.env.SEMANTIC_THRESHOLD ?? "0.85"),
  noveltyWeeks: parseInt(process.env.NOVELTY_WEEKS ?? "4", 10),

  emailFrom:
    process.env.EMAIL_FROM ?? "Weekly Intel <digest@yourdomain.com>",
  emailRecipients: (process.env.EMAIL_RECIPIENTS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean),

  cronSecret: process.env.CRON_SECRET ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;

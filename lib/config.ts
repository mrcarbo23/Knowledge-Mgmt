// Type-safe environment variable configuration

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvVarOptional(key: string): string | undefined {
  return process.env[key];
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

export const config = {
  // Database
  databaseUrl: () => getEnvVar("DATABASE_URL"),

  // AI APIs
  anthropicApiKey: () => getEnvVar("ANTHROPIC_API_KEY"),
  openaiApiKey: () => getEnvVar("OPENAI_API_KEY"),

  // Email
  resendApiKey: () => getEnvVarOptional("RESEND_API_KEY"),

  // Gmail OAuth
  gmailClientId: () => getEnvVarOptional("GMAIL_CLIENT_ID"),
  gmailClientSecret: () => getEnvVarOptional("GMAIL_CLIENT_SECRET"),
  gmailRedirectUri: () => getEnvVarOptional("GMAIL_REDIRECT_URI"),

  // Model Configuration
  claudeModel: getEnvVar("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
  embeddingModel: getEnvVar("EMBEDDING_MODEL", "text-embedding-3-small"),
  embeddingDimension: 1536,

  // Thresholds
  fingerprintThreshold: getEnvVarNumber("FINGERPRINT_THRESHOLD", 0.8),
  semanticThreshold: getEnvVarNumber("SEMANTIC_THRESHOLD", 0.85),
  noveltyWeeks: getEnvVarNumber("NOVELTY_WEEKS", 4),

  // Email Configuration
  emailFrom: getEnvVar("EMAIL_FROM", "Weekly Intel <digest@yourdomain.com>"),
  emailRecipients: () => {
    const recipients = getEnvVarOptional("EMAIL_RECIPIENTS");
    return recipients ? recipients.split(",").map((r) => r.trim()) : [];
  },

  // Security
  cronSecret: () => getEnvVarOptional("CRON_SECRET"),

  // App URL
  appUrl: getEnvVar("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
};

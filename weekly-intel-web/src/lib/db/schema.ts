import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Custom pgvector type
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// ─── Sources ───────────────────────────────────────────────────────
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(), // substack, gmail, youtube
  config: jsonb("config").notNull().default({}),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sourcesRelations = relations(sources, ({ many }) => ({
  contentItems: many(contentItems),
}));

// ─── Content Items ─────────────────────────────────────────────────
export const contentItems = pgTable(
  "content_items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: varchar("external_id", { length: 512 }).notNull(),
    title: varchar("title", { length: 1024 }),
    author: varchar("author", { length: 255 }),
    contentText: text("content_text"),
    contentHtml: text("content_html"),
    url: varchar("url", { length: 2048 }),
    publishedAt: timestamp("published_at"),
    ingestedAt: timestamp("ingested_at").defaultNow(),
    fingerprint: varchar("fingerprint", { length: 512 }),
  },
  (table) => [
    uniqueIndex("uq_source_external").on(table.sourceId, table.externalId),
    index("ix_content_items_published_at").on(table.publishedAt),
    index("ix_content_items_fingerprint").on(table.fingerprint),
  ]
);

export const contentItemsRelations = relations(contentItems, ({ one }) => ({
  source: one(sources, {
    fields: [contentItems.sourceId],
    references: [sources.id],
  }),
  processedItem: one(processedItems),
}));

// ─── Processed Items ───────────────────────────────────────────────
export const processedItems = pgTable(
  "processed_items",
  {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id")
      .notNull()
      .unique()
      .references(() => contentItems.id),
    summary: text("summary"),
    keyInformation: jsonb("key_information").$type<string[]>(),
    themes: jsonb("themes").$type<string[]>(),
    hotTakes: jsonb("hot_takes").$type<{ take: string; context: string }[]>(),
    entities: jsonb("entities").$type<{
      people?: string[];
      companies?: string[];
      technologies?: string[];
    }>(),
    embedding: vector("embedding"),
    processedAt: timestamp("processed_at").defaultNow(),
  },
  (table) => [index("ix_processed_items_processed_at").on(table.processedAt)]
);

export const processedItemsRelations = relations(
  processedItems,
  ({ one, many }) => ({
    contentItem: one(contentItems, {
      fields: [processedItems.contentItemId],
      references: [contentItems.id],
    }),
    clusterMemberships: many(clusterMembers),
  })
);

// ─── Story Clusters ────────────────────────────────────────────────
export const storyClusters = pgTable(
  "story_clusters",
  {
    id: serial("id").primaryKey(),
    weekNumber: varchar("week_number", { length: 10 }).notNull(),
    name: varchar("name", { length: 255 }),
    canonicalItemId: integer("canonical_item_id").references(
      () => processedItems.id
    ),
    synthesizedSummary: text("synthesized_summary"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("ix_story_clusters_week_number").on(table.weekNumber)]
);

export const storyClustersRelations = relations(
  storyClusters,
  ({ one, many }) => ({
    canonicalItem: one(processedItems, {
      fields: [storyClusters.canonicalItemId],
      references: [processedItems.id],
    }),
    members: many(clusterMembers),
  })
);

// ─── Cluster Members ───────────────────────────────────────────────
export const clusterMembers = pgTable(
  "cluster_members",
  {
    id: serial("id").primaryKey(),
    clusterId: integer("cluster_id")
      .notNull()
      .references(() => storyClusters.id),
    processedItemId: integer("processed_item_id")
      .notNull()
      .references(() => processedItems.id),
    similarityScore: real("similarity_score"),
  },
  (table) => [
    uniqueIndex("uq_cluster_item").on(table.clusterId, table.processedItemId),
  ]
);

export const clusterMembersRelations = relations(clusterMembers, ({ one }) => ({
  cluster: one(storyClusters, {
    fields: [clusterMembers.clusterId],
    references: [storyClusters.id],
  }),
  processedItem: one(processedItems, {
    fields: [clusterMembers.processedItemId],
    references: [processedItems.id],
  }),
}));

// ─── Weekly Digests ────────────────────────────────────────────────
export const weeklyDigests = pgTable(
  "weekly_digests",
  {
    id: serial("id").primaryKey(),
    weekNumber: varchar("week_number", { length: 10 }).notNull().unique(),
    dateRange: varchar("date_range", { length: 50 }),
    sourcesCount: integer("sources_count").default(0),
    itemsCount: integer("items_count").default(0),
    markdownContent: text("markdown_content"),
    htmlContent: text("html_content"),
    digestData: jsonb("digest_data"), // Full DigestContent as JSON
    generatedAt: timestamp("generated_at").defaultNow(),
  },
  (table) => [index("ix_weekly_digests_week_number").on(table.weekNumber)]
);

export const weeklyDigestsRelations = relations(weeklyDigests, ({ many }) => ({
  emailLogs: many(emailLogs),
}));

// ─── Email Logs ────────────────────────────────────────────────────
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  digestId: integer("digest_id")
    .notNull()
    .references(() => weeklyDigests.id),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(), // sent, failed, bounced
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  attempts: integer("attempts").default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  errorMessage: text("error_message"),
});

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
  digest: one(weeklyDigests, {
    fields: [emailLogs.digestId],
    references: [weeklyDigests.id],
  }),
}));

// ─── Job Runs (new) ───────────────────────────────────────────────
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    jobType: varchar("job_type", { length: 50 }).notNull(), // ingest, process, digest
    status: varchar("status", { length: 50 }).notNull(), // running, completed, failed
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("ix_job_runs_job_type").on(table.jobType)]
);

// ─── Gmail Tokens (new) ──────────────────────────────────────────
export const gmailTokens = pgTable("gmail_tokens", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenType: varchar("token_type", { length: 50 }),
  expiresAt: timestamp("expires_at"),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

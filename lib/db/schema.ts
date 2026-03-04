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

// Custom pgvector type for embeddings
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// Sources table - RSS feeds, YouTube channels, Gmail
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(), // "substack" | "gmail" | "youtube"
  config: jsonb("config").default({}).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Content items - ingested content from all sources
export const contentItems = pgTable(
  "content_items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .references(() => sources.id)
      .notNull(),
    externalId: varchar("external_id", { length: 512 }).notNull(),
    title: varchar("title", { length: 1024 }),
    author: varchar("author", { length: 255 }),
    contentText: text("content_text"),
    contentHtml: text("content_html"),
    url: varchar("url", { length: 2048 }),
    publishedAt: timestamp("published_at"),
    ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
    fingerprint: varchar("fingerprint", { length: 512 }),
  },
  (table) => [
    uniqueIndex("content_items_source_external_idx").on(
      table.sourceId,
      table.externalId
    ),
    index("content_items_published_at_idx").on(table.publishedAt),
    index("content_items_fingerprint_idx").on(table.fingerprint),
  ]
);

// Processed items - AI-extracted data with embeddings
export const processedItems = pgTable("processed_items", {
  id: serial("id").primaryKey(),
  contentItemId: integer("content_item_id")
    .references(() => contentItems.id)
    .unique()
    .notNull(),
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
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// Story clusters - grouped related stories
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("story_clusters_week_idx").on(table.weekNumber)]
);

// Cluster members - items belonging to clusters
export const clusterMembers = pgTable(
  "cluster_members",
  {
    id: serial("id").primaryKey(),
    clusterId: integer("cluster_id")
      .references(() => storyClusters.id)
      .notNull(),
    processedItemId: integer("processed_item_id")
      .references(() => processedItems.id)
      .notNull(),
    similarityScore: real("similarity_score"),
  },
  (table) => [
    uniqueIndex("cluster_members_unique_idx").on(
      table.clusterId,
      table.processedItemId
    ),
  ]
);

// Weekly digests - generated summaries
export const weeklyDigests = pgTable(
  "weekly_digests",
  {
    id: serial("id").primaryKey(),
    weekNumber: varchar("week_number", { length: 10 }).unique().notNull(),
    dateRange: varchar("date_range", { length: 50 }),
    sourcesCount: integer("sources_count"),
    itemsCount: integer("items_count"),
    markdownContent: text("markdown_content"),
    htmlContent: text("html_content"),
    digestData: jsonb("digest_data"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  () => []
);

// Email logs - delivery tracking
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  digestId: integer("digest_id").references(() => weeklyDigests.id),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(), // "sent" | "failed" | "bounced"
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  attempts: integer("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  errorMessage: text("error_message"),
});

// Job runs - background job tracking
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    jobType: varchar("job_type", { length: 50 }).notNull(), // "ingest" | "process" | "digest"
    status: varchar("status", { length: 50 }).notNull(), // "running" | "completed" | "failed"
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("job_runs_type_idx").on(table.jobType)]
);

// Gmail tokens - OAuth token storage
export const gmailTokens = pgTable("gmail_tokens", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenType: varchar("token_type", { length: 50 }),
  expiresAt: timestamp("expires_at"),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const sourcesRelations = relations(sources, ({ many }) => ({
  contentItems: many(contentItems),
}));

export const contentItemsRelations = relations(
  contentItems,
  ({ one, many }) => ({
    source: one(sources, {
      fields: [contentItems.sourceId],
      references: [sources.id],
    }),
    processedItem: many(processedItems),
  })
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

export const weeklyDigestsRelations = relations(weeklyDigests, ({ many }) => ({
  emailLogs: many(emailLogs),
}));

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
  digest: one(weeklyDigests, {
    fields: [emailLogs.digestId],
    references: [weeklyDigests.id],
  }),
}));

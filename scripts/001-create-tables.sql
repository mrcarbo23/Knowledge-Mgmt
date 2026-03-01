-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Sources table
CREATE TABLE IF NOT EXISTS "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

-- Content Items table
CREATE TABLE IF NOT EXISTS "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"title" varchar(1024),
	"author" varchar(255),
	"content_text" text,
	"content_html" text,
	"url" varchar(2048),
	"published_at" timestamp,
	"ingested_at" timestamp DEFAULT now(),
	"fingerprint" varchar(512)
);

-- Processed Items table
CREATE TABLE IF NOT EXISTS "processed_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"summary" text,
	"key_information" jsonb,
	"themes" jsonb,
	"hot_takes" jsonb,
	"entities" jsonb,
	"embedding" vector(1536),
	"processed_at" timestamp DEFAULT now(),
	CONSTRAINT "processed_items_content_item_id_unique" UNIQUE("content_item_id")
);

-- Story Clusters table
CREATE TABLE IF NOT EXISTS "story_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_number" varchar(10) NOT NULL,
	"name" varchar(255),
	"canonical_item_id" integer,
	"synthesized_summary" text,
	"created_at" timestamp DEFAULT now()
);

-- Cluster Members table
CREATE TABLE IF NOT EXISTS "cluster_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"processed_item_id" integer NOT NULL,
	"similarity_score" real
);

-- Weekly Digests table
CREATE TABLE IF NOT EXISTS "weekly_digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_number" varchar(10) NOT NULL,
	"date_range" varchar(50),
	"sources_count" integer DEFAULT 0,
	"items_count" integer DEFAULT 0,
	"markdown_content" text,
	"html_content" text,
	"digest_data" jsonb,
	"generated_at" timestamp DEFAULT now(),
	CONSTRAINT "weekly_digests_week_number_unique" UNIQUE("week_number")
);

-- Email Logs table
CREATE TABLE IF NOT EXISTS "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_id" integer NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"provider_message_id" varchar(255),
	"attempts" integer DEFAULT 0,
	"last_attempt_at" timestamp,
	"error_message" text
);

-- Job Runs table
CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

-- Gmail Tokens table
CREATE TABLE IF NOT EXISTS "gmail_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_type" varchar(50),
	"expires_at" timestamp,
	"scope" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

-- Foreign keys
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "processed_items" ADD CONSTRAINT "processed_items_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "story_clusters" ADD CONSTRAINT "story_clusters_canonical_item_id_processed_items_id_fk" FOREIGN KEY ("canonical_item_id") REFERENCES "public"."processed_items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_processed_item_id_processed_items_id_fk" FOREIGN KEY ("processed_item_id") REFERENCES "public"."processed_items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_digest_id_weekly_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."weekly_digests"("id") ON DELETE no action ON UPDATE no action;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "uq_source_external" ON "content_items" USING btree ("source_id","external_id");
CREATE INDEX IF NOT EXISTS "ix_content_items_published_at" ON "content_items" USING btree ("published_at");
CREATE INDEX IF NOT EXISTS "ix_content_items_fingerprint" ON "content_items" USING btree ("fingerprint");
CREATE INDEX IF NOT EXISTS "ix_processed_items_processed_at" ON "processed_items" USING btree ("processed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cluster_item" ON "cluster_members" USING btree ("cluster_id","processed_item_id");
CREATE INDEX IF NOT EXISTS "ix_story_clusters_week_number" ON "story_clusters" USING btree ("week_number");
CREATE INDEX IF NOT EXISTS "ix_weekly_digests_week_number" ON "weekly_digests" USING btree ("week_number");
CREATE INDEX IF NOT EXISTS "ix_job_runs_job_type" ON "job_runs" USING btree ("job_type");

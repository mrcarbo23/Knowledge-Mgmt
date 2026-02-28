import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import {
  processedItems,
  contentItems,
  sources,
  storyClusters,
  clusterMembers,
  weeklyDigests,
} from "@/lib/db/schema";
import { config } from "@/lib/config";
import { getWeekNumber, getWeekDateRange } from "@/lib/utils";
import {
  SYNTHESIS_SYSTEM_PROMPT,
  CLUSTER_SYNTHESIS_SYSTEM_PROMPT,
  buildClusterSynthesisPrompt,
  buildExecutiveSummaryPrompt,
} from "@/lib/prompts";
import { renderMarkdown } from "./markdown";
import { renderHtmlEmail } from "./html";
import { eq, and, gte, lt, sql } from "drizzle-orm";

export interface ThemeContent {
  name: string;
  synthesizedSummary: string;
  sources: string[];
  sourceUrls: string[];
  isNovel: boolean;
  isFollowup: boolean;
}

export interface HotTake {
  take: string;
  source: string;
  author: string;
  assessment: string;
}

export interface SourceSummary {
  name: string;
  sourceType: string;
  itemCount: number;
}

export interface DigestContent {
  weekNumber: string;
  dateRange: string;
  sourcesCount: number;
  itemsCount: number;
  executiveSummary: string[];
  themes: ThemeContent[];
  hotTakes: HotTake[];
  signalsToWatch: string[];
  sourceIndex: SourceSummary[];
  generatedAt: Date;
}

const SYNTHESIS_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_digest",
    description: "Create the digest content",
    input_schema: {
      type: "object" as const,
      properties: {
        executive_summary: {
          type: "array",
          items: { type: "string" },
          description:
            "3-5 key bullet points summarizing the most important items",
        },
        signals_to_watch: {
          type: "array",
          items: { type: "string" },
          description: "Emerging trends or data points worth monitoring",
        },
      },
      required: ["executive_summary", "signals_to_watch"],
    },
  },
];

const CLUSTER_SYNTHESIS_TOOLS: Anthropic.Tool[] = [
  {
    name: "synthesize_cluster",
    description: "Synthesize a story cluster",
    input_schema: {
      type: "object" as const,
      properties: {
        theme_name: {
          type: "string",
          description: "Short name for this theme/story (3-6 words)",
        },
        synthesized_summary: {
          type: "string",
          description:
            'Synthesized summary incorporating unique details from all sources. Format: "According to [Source A], [key point]. [Source B] adds that [additional detail]."',
        },
      },
      required: ["theme_name", "synthesized_summary"],
    },
  },
];

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropicClient;
}

export async function generateDigest(
  weekNumber?: string
): Promise<DigestContent> {
  const week = weekNumber ?? getWeekNumber();
  const { start: weekStart, end: weekEnd, label: dateRange } = getWeekDateRange(week);
  const weekEndPlusOne = new Date(weekEnd);
  weekEndPlusOne.setDate(weekEndPlusOne.getDate() + 1);

  // Get processed items for this week (by published_at or ingested_at)
  let items = await db
    .select({
      processedId: processedItems.id,
      summary: processedItems.summary,
      keyInformation: processedItems.keyInformation,
      themes: processedItems.themes,
      hotTakes: processedItems.hotTakes,
      entities: processedItems.entities,
      contentItemId: processedItems.contentItemId,
      title: contentItems.title,
      author: contentItems.author,
      url: contentItems.url,
      sourceId: contentItems.sourceId,
      publishedAt: contentItems.publishedAt,
    })
    .from(processedItems)
    .innerJoin(contentItems, eq(processedItems.contentItemId, contentItems.id))
    .where(
      and(gte(contentItems.publishedAt, weekStart), lt(contentItems.publishedAt, weekEndPlusOne))
    );

  if (items.length === 0) {
    // Fallback to ingested_at
    items = await db
      .select({
        processedId: processedItems.id,
        summary: processedItems.summary,
        keyInformation: processedItems.keyInformation,
        themes: processedItems.themes,
        hotTakes: processedItems.hotTakes,
        entities: processedItems.entities,
        contentItemId: processedItems.contentItemId,
        title: contentItems.title,
        author: contentItems.author,
        url: contentItems.url,
        sourceId: contentItems.sourceId,
        publishedAt: contentItems.publishedAt,
      })
      .from(processedItems)
      .innerJoin(
        contentItems,
        eq(processedItems.contentItemId, contentItems.id)
      )
      .where(
        and(
          gte(contentItems.ingestedAt, weekStart),
          lt(contentItems.ingestedAt, weekEndPlusOne)
        )
      );
  }

  if (items.length === 0) {
    return {
      weekNumber: week,
      dateRange,
      sourcesCount: 0,
      itemsCount: 0,
      executiveSummary: ["No content processed this week."],
      themes: [],
      hotTakes: [],
      signalsToWatch: [],
      sourceIndex: [],
      generatedAt: new Date(),
    };
  }

  // Build source index
  const sourceCounts = new Map<string, { name: string; type: string; count: number }>();
  for (const item of items) {
    const [source] = await db
      .select({ name: sources.name, sourceType: sources.sourceType })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);

    if (source) {
      const key = `${source.name}|${source.sourceType}`;
      const existing = sourceCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        sourceCounts.set(key, {
          name: source.name,
          type: source.sourceType,
          count: 1,
        });
      }
    }
  }

  const sourceIndex: SourceSummary[] = [...sourceCounts.values()]
    .map((s) => ({
      name: s.name,
      sourceType: s.type,
      itemCount: s.count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Get clusters
  const clusters = await db
    .select()
    .from(storyClusters)
    .where(eq(storyClusters.weekNumber, week));

  // Synthesize clusters into themes
  const themes: ThemeContent[] = [];
  const clusteredItemIds = new Set<number>();

  for (const cluster of clusters) {
    const members = await db
      .select({
        processedItemId: clusterMembers.processedItemId,
      })
      .from(clusterMembers)
      .where(eq(clusterMembers.clusterId, cluster.id));

    const memberItems = items.filter((item) =>
      members.some((m) => m.processedItemId === item.processedId)
    );

    if (memberItems.length === 0) continue;

    const theme = await synthesizeCluster(memberItems);
    if (theme) {
      themes.push(theme);
      for (const m of members) {
        clusteredItemIds.add(m.processedItemId);
      }
    }
  }

  // Add unclustered items as individual themes
  for (const item of items) {
    if (clusteredItemIds.has(item.processedId)) continue;

    const [source] = await db
      .select({ name: sources.name })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);

    const isFollowup = (item.keyInformation as string[] ?? []).includes(
      "[Follow-up story]"
    );

    themes.push({
      name: generateThemeName(item.summary ?? ""),
      synthesizedSummary: item.summary ?? "",
      sources: [source?.name ?? "Unknown"],
      sourceUrls: [item.url ?? ""],
      isNovel: !isFollowup,
      isFollowup,
    });
  }

  // Collect hot takes
  const hotTakes: HotTake[] = [];
  for (const item of items) {
    const takes = (item.hotTakes as { take: string; context: string }[]) ?? [];
    for (const take of takes) {
      const [source] = await db
        .select({ name: sources.name })
        .from(sources)
        .where(eq(sources.id, item.sourceId))
        .limit(1);

      hotTakes.push({
        take: take.take ?? "",
        source: source?.name ?? "Unknown",
        author: item.author ?? "Unknown",
        assessment: take.context ?? "",
      });
    }
  }

  // Generate executive summary
  const { executiveSummary, signalsToWatch } = await generateSummary(
    themes,
    hotTakes
  );

  return {
    weekNumber: week,
    dateRange,
    sourcesCount: sourceIndex.length,
    itemsCount: items.length,
    executiveSummary,
    themes,
    hotTakes: hotTakes.slice(0, 10),
    signalsToWatch,
    sourceIndex,
    generatedAt: new Date(),
  };
}

async function synthesizeCluster(
  memberItems: Array<{
    processedId: number;
    summary: string | null;
    keyInformation: unknown;
    sourceId: number;
    url: string | null;
  }>
): Promise<ThemeContent | null> {
  if (memberItems.length === 0) return null;

  const memberSources: string[] = [];
  const sourceUrls: string[] = [];
  const summaries: string[] = [];

  for (const item of memberItems) {
    const [source] = await db
      .select({ name: sources.name })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);

    const sourceName = source?.name ?? "Unknown";
    memberSources.push(sourceName);
    sourceUrls.push(item.url ?? "");
    summaries.push(`[${sourceName}]: ${item.summary ?? ""}`);
  }

  try {
    const client = getClient();
    const prompt = buildClusterSynthesisPrompt(summaries.join("\n"));

    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: CLUSTER_SYNTHESIS_SYSTEM_PROMPT,
      tools: CLUSTER_SYNTHESIS_TOOLS,
      tool_choice: { type: "tool" as const, name: "synthesize_cluster" },
      messages: [{ role: "user", content: prompt }],
    });

    for (const block of response.content) {
      if (
        block.type === "tool_use" &&
        block.name === "synthesize_cluster"
      ) {
        const data = block.input as Record<string, unknown>;
        const isFollowup = memberItems.some((item) =>
          ((item.keyInformation as string[]) ?? []).includes(
            "[Follow-up story]"
          )
        );

        return {
          name: (data.theme_name as string) ?? "Topic",
          synthesizedSummary: (data.synthesized_summary as string) ?? "",
          sources: [...new Set(memberSources)],
          sourceUrls,
          isNovel: !isFollowup,
          isFollowup,
        };
      }
    }
  } catch (e) {
    console.error("Failed to synthesize cluster:", e);
  }

  // Fallback
  return {
    name: generateThemeName(memberItems[0].summary ?? ""),
    synthesizedSummary: memberItems[0].summary ?? "",
    sources: [...new Set(memberSources)],
    sourceUrls,
    isNovel: true,
    isFollowup: false,
  };
}

function generateThemeName(summary: string): string {
  const words = summary.split(/\s+/).slice(0, 6);
  let name = words.join(" ");
  if (name.length > 50) name = name.slice(0, 47) + "...";
  return name;
}

async function generateSummary(
  themes: ThemeContent[],
  hotTakes: HotTake[]
): Promise<{ executiveSummary: string[]; signalsToWatch: string[] }> {
  const themeSummaries = themes.slice(0, 15).map((theme) => {
    const novelty = theme.isNovel ? "NEW" : "ONGOING";
    return `[${novelty}] ${theme.name}: ${theme.synthesizedSummary.slice(0, 200)}`;
  });

  const hotTakeSummaries = hotTakes.slice(0, 5).map((take) => {
    return `- ${take.author}: ${take.take}`;
  });

  const prompt = buildExecutiveSummaryPrompt(
    themeSummaries.join("\n"),
    hotTakeSummaries.length > 0
      ? hotTakeSummaries.join("\n")
      : "None notable"
  );

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: SYNTHESIS_SYSTEM_PROMPT,
      tools: SYNTHESIS_TOOLS,
      tool_choice: { type: "tool" as const, name: "create_digest" },
      messages: [{ role: "user", content: prompt }],
    });

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "create_digest") {
        const data = block.input as Record<string, unknown>;
        return {
          executiveSummary: (data.executive_summary as string[]) ?? [],
          signalsToWatch: (data.signals_to_watch as string[]) ?? [],
        };
      }
    }
  } catch (e) {
    console.error("Failed to generate summary:", e);
  }

  return {
    executiveSummary: [
      "Digest generation encountered an error. Review themes below.",
    ],
    signalsToWatch: [],
  };
}

export async function saveDigest(content: DigestContent): Promise<number> {
  const markdownContent = renderMarkdown(content);
  const htmlContent = renderHtmlEmail(content);

  const existing = await db
    .select({ id: weeklyDigests.id })
    .from(weeklyDigests)
    .where(eq(weeklyDigests.weekNumber, content.weekNumber))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(weeklyDigests)
      .set({
        dateRange: content.dateRange,
        sourcesCount: content.sourcesCount,
        itemsCount: content.itemsCount,
        markdownContent,
        htmlContent,
        digestData: content as unknown as Record<string, unknown>,
        generatedAt: content.generatedAt,
      })
      .where(eq(weeklyDigests.id, existing[0].id));
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(weeklyDigests)
    .values({
      weekNumber: content.weekNumber,
      dateRange: content.dateRange,
      sourcesCount: content.sourcesCount,
      itemsCount: content.itemsCount,
      markdownContent,
      htmlContent,
      digestData: content as unknown as Record<string, unknown>,
      generatedAt: content.generatedAt,
    })
    .returning({ id: weeklyDigests.id });

  return inserted.id;
}

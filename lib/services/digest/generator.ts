import Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/lib/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { config } from "@/lib/config";

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey(),
    });
  }
  return anthropicClient;
}

export interface DigestTheme {
  name: string;
  summary: string;
  noveltyStatus: "new" | "follow-up" | "ongoing";
  items: {
    title: string;
    author?: string;
    source: string;
    url?: string;
    keyPoints: string[];
  }[];
}

export interface DigestHotTake {
  take: string;
  context: string;
  source: string;
  author?: string;
}

export interface DigestContent {
  weekNumber: string;
  dateRange: string;
  executiveSummary: string[];
  signalsToWatch: string[];
  themes: DigestTheme[];
  hotTakes: DigestHotTake[];
  sourceIndex: { name: string; type: string; itemCount: number }[];
  generatedAt: string;
}

function getWeekNumber(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

function getWeekDateRange(weekNumber: string): { start: Date; end: Date } {
  const [year, week] = weekNumber.split("-W").map(Number);
  const jan1 = new Date(year, 0, 1);
  const days = (week - 1) * 7 - jan1.getDay() + 1;
  const start = new Date(year, 0, days + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const startStr = start.toLocaleDateString("en-US", options);
  const endStr = end.toLocaleDateString("en-US", {
    ...options,
    year: "numeric",
  });
  return `${startStr} - ${endStr}`;
}

const SYNTHESIZE_TOOL = {
  name: "synthesize_cluster",
  description: "Synthesize a cluster of related stories into a theme",
  input_schema: {
    type: "object" as const,
    properties: {
      theme_name: {
        type: "string",
        description: "A concise name for this theme (3-6 words)",
      },
      synthesized_summary: {
        type: "string",
        description:
          "A synthesized summary combining insights from all related stories (2-3 sentences)",
      },
    },
    required: ["theme_name", "synthesized_summary"],
  },
};

const DIGEST_TOOL = {
  name: "create_digest",
  description: "Create executive summary and signals for the digest",
  input_schema: {
    type: "object" as const,
    properties: {
      executive_summary: {
        type: "array",
        items: { type: "string" },
        description:
          "3-5 bullet points summarizing the most important developments this week",
      },
      signals_to_watch: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 emerging trends or signals worth monitoring in coming weeks",
      },
    },
    required: ["executive_summary", "signals_to_watch"],
  },
};

async function synthesizeCluster(
  items: {
    summary: string;
    keyInformation: string[];
    themes: string[];
  }[]
): Promise<{ themeName: string; synthesizedSummary: string }> {
  const anthropic = getAnthropic();

  const itemSummaries = items
    .map(
      (item, i) =>
        `Item ${i + 1}:\nSummary: ${item.summary}\nKey Points: ${item.keyInformation.join(", ")}\nThemes: ${item.themes.join(", ")}`
    )
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    tools: [SYNTHESIZE_TOOL],
    tool_choice: { type: "tool", name: "synthesize_cluster" },
    messages: [
      {
        role: "user",
        content: `Synthesize these related stories into a single theme:\n\n${itemSummaries}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    const input = toolUse.input as {
      theme_name?: string;
      synthesized_summary?: string;
    };
    return {
      themeName: input.theme_name || "Untitled Theme",
      synthesizedSummary: input.synthesized_summary || "",
    };
  }

  return { themeName: "Untitled Theme", synthesizedSummary: "" };
}

async function generateExecutiveSummary(
  themes: DigestTheme[],
  hotTakes: DigestHotTake[]
): Promise<{ executiveSummary: string[]; signalsToWatch: string[] }> {
  const anthropic = getAnthropic();

  const themeSummaries = themes
    .map(
      (t) =>
        `Theme: ${t.name}\nStatus: ${t.noveltyStatus}\nSummary: ${t.summary}`
    )
    .join("\n\n");

  const hotTakeSummaries = hotTakes
    .slice(0, 10)
    .map((ht) => `- ${ht.take} (${ht.source})`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    tools: [DIGEST_TOOL],
    tool_choice: { type: "tool", name: "create_digest" },
    messages: [
      {
        role: "user",
        content: `Create an executive summary and signals to watch based on this week's themes and hot takes:\n\nThemes:\n${themeSummaries}\n\nNotable Takes:\n${hotTakeSummaries}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    const input = toolUse.input as {
      executive_summary?: string[];
      signals_to_watch?: string[];
    };
    return {
      executiveSummary: input.executive_summary || [],
      signalsToWatch: input.signals_to_watch || [],
    };
  }

  return { executiveSummary: [], signalsToWatch: [] };
}

export async function generateDigest(
  weekNumber?: string
): Promise<DigestContent> {
  const currentWeek = weekNumber || getWeekNumber(new Date());
  const { start, end } = getWeekDateRange(currentWeek);

  // Get processed items for the week
  const processedItemsData = await db
    .select({
      processed: schema.processedItems,
      content: schema.contentItems,
      source: schema.sources,
    })
    .from(schema.processedItems)
    .innerJoin(
      schema.contentItems,
      eq(schema.processedItems.contentItemId, schema.contentItems.id)
    )
    .innerJoin(schema.sources, eq(schema.contentItems.sourceId, schema.sources.id))
    .where(
      and(
        gte(schema.contentItems.ingestedAt, start),
        lte(schema.contentItems.ingestedAt, end)
      )
    );

  // Build source index
  const sourceMap = new Map<number, { name: string; type: string; count: number }>();
  for (const item of processedItemsData) {
    const existing = sourceMap.get(item.source.id);
    if (existing) {
      existing.count++;
    } else {
      sourceMap.set(item.source.id, {
        name: item.source.name,
        type: item.source.sourceType,
        count: 1,
      });
    }
  }
  const sourceIndex = Array.from(sourceMap.values()).map((s) => ({
    name: s.name,
    type: s.type,
    itemCount: s.count,
  }));

  // Get story clusters for the week
  const clusters = await db
    .select()
    .from(schema.storyClusters)
    .where(eq(schema.storyClusters.weekNumber, currentWeek));

  const themes: DigestTheme[] = [];
  const clusteredItemIds = new Set<number>();

  // Process each cluster
  for (const cluster of clusters) {
    // Get cluster members
    const members = await db
      .select({
        member: schema.clusterMembers,
        processed: schema.processedItems,
        content: schema.contentItems,
        source: schema.sources,
      })
      .from(schema.clusterMembers)
      .innerJoin(
        schema.processedItems,
        eq(schema.clusterMembers.processedItemId, schema.processedItems.id)
      )
      .innerJoin(
        schema.contentItems,
        eq(schema.processedItems.contentItemId, schema.contentItems.id)
      )
      .innerJoin(schema.sources, eq(schema.contentItems.sourceId, schema.sources.id))
      .where(eq(schema.clusterMembers.clusterId, cluster.id));

    if (members.length === 0) continue;

    // Mark items as clustered
    for (const m of members) {
      clusteredItemIds.add(m.processed.id);
    }

    // Synthesize cluster if not already done
    let themeName = cluster.name;
    let synthesizedSummary = cluster.synthesizedSummary;

    if (!themeName || !synthesizedSummary) {
      const synthesis = await synthesizeCluster(
        members.map((m) => ({
          summary: m.processed.summary || "",
          keyInformation: (m.processed.keyInformation as string[]) || [],
          themes: (m.processed.themes as string[]) || [],
        }))
      );
      themeName = synthesis.themeName;
      synthesizedSummary = synthesis.synthesizedSummary;

      // Update cluster
      await db
        .update(schema.storyClusters)
        .set({ name: themeName, synthesizedSummary })
        .where(eq(schema.storyClusters.id, cluster.id));
    }

    // Determine novelty status
    const hasFollowup = members.some((m) =>
      ((m.processed.keyInformation as string[]) || []).some((ki) =>
        ki.includes("[Follow-up story]")
      )
    );
    const noveltyStatus = hasFollowup ? "follow-up" : "new";

    themes.push({
      name: themeName!,
      summary: synthesizedSummary!,
      noveltyStatus,
      items: members.map((m) => ({
        title: m.content.title || "Untitled",
        author: m.content.author || undefined,
        source: m.source.name,
        url: m.content.url || undefined,
        keyPoints: (m.processed.keyInformation as string[]) || [],
      })),
    });
  }

  // Add unclustered items as individual themes
  const unclusteredItems = processedItemsData.filter(
    (item) => !clusteredItemIds.has(item.processed.id)
  );

  for (const item of unclusteredItems) {
    const hasFollowup = ((item.processed.keyInformation as string[]) || []).some(
      (ki) => ki.includes("[Follow-up story]")
    );

    themes.push({
      name: item.content.title || "Untitled",
      summary: item.processed.summary || "",
      noveltyStatus: hasFollowup ? "follow-up" : "ongoing",
      items: [
        {
          title: item.content.title || "Untitled",
          author: item.content.author || undefined,
          source: item.source.name,
          url: item.content.url || undefined,
          keyPoints: (item.processed.keyInformation as string[]) || [],
        },
      ],
    });
  }

  // Collect hot takes
  const hotTakes: DigestHotTake[] = [];
  for (const item of processedItemsData) {
    const takes = (item.processed.hotTakes as { take: string; context: string }[]) || [];
    for (const take of takes) {
      hotTakes.push({
        take: take.take,
        context: take.context,
        source: item.source.name,
        author: item.content.author || undefined,
      });
    }
  }

  // Generate executive summary
  const { executiveSummary, signalsToWatch } = await generateExecutiveSummary(
    themes,
    hotTakes
  );

  return {
    weekNumber: currentWeek,
    dateRange: formatDateRange(start, end),
    executiveSummary,
    signalsToWatch,
    themes,
    hotTakes,
    sourceIndex,
    generatedAt: new Date().toISOString(),
  };
}

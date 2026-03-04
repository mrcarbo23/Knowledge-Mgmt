import Anthropic from "@anthropic-ai/sdk";
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

export interface ExtractionResult {
  summary: string;
  keyInformation: string[];
  themes: string[];
  hotTakes: { take: string; context: string }[];
  entities: {
    people?: string[];
    companies?: string[];
    technologies?: string[];
  };
}

const EXTRACTION_TOOL = {
  name: "extract_content",
  description:
    "Extract key information from content for a weekly intelligence digest",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "A concise 2-3 sentence summary of the main points",
      },
      key_information: {
        type: "array",
        items: { type: "string" },
        description: "List of key facts, announcements, or insights",
      },
      themes: {
        type: "array",
        items: { type: "string" },
        description: "Main themes or topics covered",
      },
      hot_takes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            take: { type: "string", description: "The hot take or opinion" },
            context: {
              type: "string",
              description: "Brief context for the take",
            },
          },
          required: ["take", "context"],
        },
        description: "Notable opinions, predictions, or controversial takes",
      },
      entities: {
        type: "object",
        properties: {
          people: {
            type: "array",
            items: { type: "string" },
            description: "Notable people mentioned",
          },
          companies: {
            type: "array",
            items: { type: "string" },
            description: "Companies or organizations mentioned",
          },
          technologies: {
            type: "array",
            items: { type: "string" },
            description: "Technologies, products, or tools mentioned",
          },
        },
        description: "Named entities extracted from the content",
      },
    },
    required: [
      "summary",
      "key_information",
      "themes",
      "hot_takes",
      "entities",
    ],
  },
};

const SYSTEM_PROMPT = `You are an expert analyst preparing content for a weekly intelligence digest. 
Your task is to extract key information, themes, and insights from various content sources.
Focus on actionable information, notable opinions, and significant developments.
Be concise but comprehensive. Identify the most important takeaways.`;

export async function extractContent(
  content: string,
  metadata: {
    title?: string | null;
    author?: string | null;
    sourceType: string;
  }
): Promise<ExtractionResult> {
  const anthropic = getAnthropic();

  // Truncate content if too long
  const truncatedContent = content.slice(0, 50000);

  // Build context string
  const contextParts: string[] = [];
  if (metadata.title) contextParts.push(`Title: ${metadata.title}`);
  if (metadata.author) contextParts.push(`Author: ${metadata.author}`);
  contextParts.push(`Source Type: ${metadata.sourceType}`);

  const userMessage = `${contextParts.join("\n")}\n\nContent:\n${truncatedContent}`;

  try {
    const response = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_content" },
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    // Find tool use in response
    const toolUse = response.content.find((block) => block.type === "tool_use");

    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as {
        summary?: string;
        key_information?: string[];
        themes?: string[];
        hot_takes?: { take: string; context: string }[];
        entities?: {
          people?: string[];
          companies?: string[];
          technologies?: string[];
        };
      };

      return {
        summary: input.summary || "",
        keyInformation: input.key_information || [],
        themes: input.themes || [],
        hotTakes: input.hot_takes || [],
        entities: input.entities || {},
      };
    }

    // Fallback: try to extract from text response
    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock && textBlock.type === "text") {
      return {
        summary: textBlock.text.slice(0, 500),
        keyInformation: [],
        themes: [],
        hotTakes: [],
        entities: {},
      };
    }

    throw new Error("No valid response from Claude");
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}

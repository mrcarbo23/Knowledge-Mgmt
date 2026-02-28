import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from "@/lib/prompts";

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

const EXTRACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "extract_content",
    description: "Extract structured information from content",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "A concise 2-3 sentence summary of the content",
        },
        key_information: {
          type: "array",
          items: { type: "string" },
          description:
            "List of key facts, announcements, or data points",
        },
        themes: {
          type: "array",
          items: { type: "string" },
          description: "Main themes or topics discussed",
        },
        hot_takes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              take: {
                type: "string",
                description: "The contrarian or notable opinion",
              },
              context: {
                type: "string",
                description: "Brief context about why this is notable",
              },
            },
            required: ["take", "context"],
          },
          description: "Contrarian views or notable opinions",
        },
        entities: {
          type: "object",
          properties: {
            people: {
              type: "array",
              items: { type: "string" },
              description: "People mentioned",
            },
            companies: {
              type: "array",
              items: { type: "string" },
              description: "Companies or organizations mentioned",
            },
            technologies: {
              type: "array",
              items: { type: "string" },
              description:
                "Technologies, products, or concepts mentioned",
            },
          },
          description: "Named entities extracted from content",
        },
      },
      required: [
        "summary",
        "key_information",
        "themes",
        "entities",
      ],
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

export async function extractContent(
  content: string,
  title?: string,
  author?: string,
  sourceType?: string
): Promise<ExtractionResult> {
  const contextParts: string[] = [];
  if (title) contextParts.push(`Title: ${title}`);
  if (author) contextParts.push(`Author: ${author}`);
  if (sourceType) contextParts.push(`Source type: ${sourceType}`);
  const context = contextParts.join("\n");

  // Truncate content if too long
  const maxLength = 50000;
  const truncatedContent =
    content.length > maxLength
      ? content.slice(0, maxLength) + "\n[Content truncated...]"
      : content;

  const userMessage = buildExtractionUserPrompt(truncatedContent, context);
  const client = getClient();

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: EXTRACTION_TOOLS,
    tool_choice: { type: "tool" as const, name: "extract_content" },
    messages: [{ role: "user", content: userMessage }],
  });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "extract_content") {
      const data = block.input as Record<string, unknown>;
      return {
        summary: (data.summary as string) ?? "",
        keyInformation: (data.key_information as string[]) ?? [],
        themes: (data.themes as string[]) ?? [],
        hotTakes:
          (data.hot_takes as { take: string; context: string }[]) ?? [],
        entities:
          (data.entities as ExtractionResult["entities"]) ?? {},
      };
    }
  }

  // Fallback
  const textContent = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    summary: textContent.slice(0, 500) || "Failed to extract summary",
    keyInformation: [],
    themes: [],
    hotTakes: [],
    entities: {},
  };
}

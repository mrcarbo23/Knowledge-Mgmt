import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export interface IngestResult {
  sourceId: number;
  itemsFound: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsFailed: number;
  errors: string[];
}

interface YouTubeConfig {
  channelId?: string;
  channelUrl?: string;
  playlistId?: string;
  playlistUrl?: string;
  videoUrls?: string[];
  videoIds?: string[];
  maxVideos?: number;
}

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract channel ID from URL
function extractChannelId(url: string): string | null {
  const patterns = [
    /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/@([a-zA-Z0-9_-]+)/,
    /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract playlist ID from URL
function extractPlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Fetch video IDs from a playlist by scraping the page
async function fetchPlaylistVideos(playlistId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://www.youtube.com/playlist?list=${playlistId}`
    );
    const html = await response.text();

    // Extract video IDs from the page HTML
    const videoIds: string[] = [];
    const regex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (!videoIds.includes(match[1])) {
        videoIds.push(match[1]);
      }
    }
    return videoIds;
  } catch {
    return [];
  }
}

// Fetch video IDs from a channel RSS feed
async function fetchChannelVideos(channelId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    );
    const xml = await response.text();

    const videoIds: string[] = [];
    const regex = /<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      videoIds.push(match[1]);
    }
    return videoIds;
  } catch {
    return [];
  }
}

// Fetch video metadata via oEmbed
async function fetchVideoMetadata(
  videoId: string
): Promise<{ title: string; author: string } | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!response.ok) return null;
    const data = await response.json();
    return {
      title: data.title || "",
      author: data.author_name || "",
    };
  } catch {
    return null;
  }
}

// Fetch video transcript
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const watchResponse = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`
    );
    const html = await watchResponse.text();

    // Find caption track URL
    const captionMatch = html.match(/"captionTracks":\[.*?"baseUrl":"([^"]+)"/);
    if (!captionMatch) return null;

    const captionUrl = captionMatch[1].replace(/\\u0026/g, "&");
    const captionResponse = await fetch(captionUrl);
    const captionXml = await captionResponse.text();

    // Parse caption XML to extract text
    const textRegex = /<text[^>]*>([^<]*)<\/text>/g;
    const texts: string[] = [];
    let match;
    while ((match = textRegex.exec(captionXml)) !== null) {
      const text = match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (text) texts.push(text);
    }

    return texts.join(" ");
  } catch {
    return null;
  }
}

export async function ingestYouTube(
  sourceId: number,
  config: YouTubeConfig,
  force = false
): Promise<IngestResult> {
  const result: IngestResult = {
    sourceId,
    itemsFound: 0,
    itemsNew: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    errors: [],
  };

  const videoIds: string[] = [];
  const maxVideos = config.maxVideos || 20;

  // Collect video IDs from various sources
  if (config.videoIds) {
    videoIds.push(...config.videoIds);
  }

  if (config.videoUrls) {
    for (const url of config.videoUrls) {
      const id = extractVideoId(url);
      if (id) videoIds.push(id);
    }
  }

  if (config.playlistId) {
    const playlistVideos = await fetchPlaylistVideos(config.playlistId);
    videoIds.push(...playlistVideos);
  }

  if (config.playlistUrl) {
    const playlistId = extractPlaylistId(config.playlistUrl);
    if (playlistId) {
      const playlistVideos = await fetchPlaylistVideos(playlistId);
      videoIds.push(...playlistVideos);
    }
  }

  if (config.channelId) {
    const channelVideos = await fetchChannelVideos(config.channelId);
    videoIds.push(...channelVideos);
  }

  if (config.channelUrl) {
    const channelId = extractChannelId(config.channelUrl);
    if (channelId) {
      const channelVideos = await fetchChannelVideos(channelId);
      videoIds.push(...channelVideos);
    }
  }

  // Deduplicate and limit
  const uniqueVideoIds = [...new Set(videoIds)].slice(0, maxVideos);
  result.itemsFound = uniqueVideoIds.length;

  for (const videoId of uniqueVideoIds) {
    try {
      // Check if exists
      const existing = await db
        .select()
        .from(schema.contentItems)
        .where(
          and(
            eq(schema.contentItems.sourceId, sourceId),
            eq(schema.contentItems.externalId, videoId)
          )
        )
        .limit(1);

      if (existing.length > 0 && !force) {
        result.itemsSkipped++;
        continue;
      }

      // Fetch metadata and transcript
      const metadata = await fetchVideoMetadata(videoId);
      const transcript = await fetchTranscript(videoId);

      if (!metadata && !transcript) {
        result.itemsFailed++;
        result.errors.push(`Failed to fetch data for video ${videoId}`);
        continue;
      }

      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      if (existing.length > 0 && force) {
        await db
          .update(schema.contentItems)
          .set({
            title: metadata?.title || null,
            author: metadata?.author || null,
            contentText: transcript || null,
            url: videoUrl,
          })
          .where(eq(schema.contentItems.id, existing[0].id));
        result.itemsNew++;
      } else {
        await db.insert(schema.contentItems).values({
          sourceId,
          externalId: videoId,
          title: metadata?.title || null,
          author: metadata?.author || null,
          contentText: transcript || null,
          url: videoUrl,
          publishedAt: new Date(),
        });
        result.itemsNew++;
      }
    } catch (error) {
      result.itemsFailed++;
      result.errors.push(
        `Failed to process video ${videoId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return result;
}

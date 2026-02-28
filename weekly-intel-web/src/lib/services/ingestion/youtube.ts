import { db } from "@/lib/db";
import { contentItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface IngestResult {
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

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractPlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("list");
  } catch {
    return null;
  }
}

async function fetchPlaylistVideos(playlistId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/playlist?list=${playlistId}`
    );
    const html = await res.text();
    const matches = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/g) ?? [];
    const ids = matches.map(
      (m) => m.match(/"videoId":"([^"]+)"/)![1]
    );
    // Deduplicate preserving order
    return [...new Set(ids)].slice(0, 50);
  } catch {
    return [];
  }
}

async function fetchChannelVideos(channelId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    );
    const xml = await res.text();
    // Simple XML parsing for video IDs
    const matches =
      xml.match(/yt:videoId>([a-zA-Z0-9_-]{11})</g) ?? [];
    return matches.map((m) => m.replace("yt:videoId>", "").replace("<", ""));
  } catch {
    return [];
  }
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Fetch the watch page to get caption tracks
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await res.text();

    // Extract caption URL from page data
    const captionMatch = html.match(
      /"captionTracks":\[.*?"baseUrl":"([^"]+)"/
    );
    if (!captionMatch) return null;

    const captionUrl = captionMatch[1].replace(/\\u0026/g, "&");
    const captionRes = await fetch(captionUrl);
    const captionXml = await captionRes.text();

    // Parse caption XML
    const texts = captionXml.match(/<text[^>]*>([\s\S]*?)<\/text>/g) ?? [];
    const transcript = texts
      .map((t) => {
        const content = t.replace(/<[^>]+>/g, "");
        return content
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
      })
      .join(" ");

    return transcript || null;
  } catch {
    return null;
  }
}

async function fetchVideoMetadata(
  videoId: string
): Promise<{ title: string; author: string | null }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title ?? `Video ${videoId}`,
        author: data.author_name ?? null,
      };
    }
  } catch {
    // ignore
  }
  return { title: `Video ${videoId}`, author: null };
}

async function getVideoIds(config: YouTubeConfig): Promise<string[]> {
  const videoIds: string[] = [];

  if (config.videoIds) videoIds.push(...config.videoIds);

  if (config.videoUrls) {
    for (const url of config.videoUrls) {
      const vid = extractVideoId(url);
      if (vid) videoIds.push(vid);
    }
  }

  let playlistId = config.playlistId ?? null;
  if (!playlistId && config.playlistUrl) {
    playlistId = extractPlaylistId(config.playlistUrl);
  }
  if (playlistId) {
    const ids = await fetchPlaylistVideos(playlistId);
    videoIds.push(...ids);
  }

  const channelId = config.channelId ?? null;
  if (channelId) {
    const ids = await fetchChannelVideos(channelId);
    videoIds.push(...ids);
  }

  // Deduplicate
  const unique = [...new Set(videoIds)];
  const maxVideos = config.maxVideos ?? 20;
  return unique.slice(0, maxVideos);
}

export async function ingestYouTube(
  sourceId: number,
  sourceConfig: YouTubeConfig,
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

  const hasSource =
    sourceConfig.channelId ||
    sourceConfig.channelUrl ||
    sourceConfig.playlistId ||
    sourceConfig.playlistUrl ||
    sourceConfig.videoUrls?.length ||
    sourceConfig.videoIds?.length;

  if (!hasSource) {
    result.errors.push(
      "YouTube source requires one of: channelId, channelUrl, playlistId, playlistUrl, videoUrls, or videoIds"
    );
    return result;
  }

  let videoIds: string[];
  try {
    videoIds = await getVideoIds(sourceConfig);
  } catch (e) {
    result.errors.push(`Failed to get video IDs: ${e}`);
    return result;
  }

  result.itemsFound = videoIds.length;

  for (const videoId of videoIds) {
    try {
      // Check if exists
      const existing = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(
          and(
            eq(contentItems.sourceId, sourceId),
            eq(contentItems.externalId, videoId)
          )
        )
        .limit(1);

      if (existing.length > 0 && !force) {
        result.itemsSkipped++;
        continue;
      }

      const transcript = await fetchTranscript(videoId);
      if (!transcript) {
        result.itemsSkipped++;
        continue;
      }

      const metadata = await fetchVideoMetadata(videoId);

      if (existing.length > 0 && force) {
        await db
          .update(contentItems)
          .set({
            title: metadata.title,
            author: metadata.author,
            contentText: transcript,
            url: `https://www.youtube.com/watch?v=${videoId}`,
          })
          .where(eq(contentItems.id, existing[0].id));
        result.itemsSkipped++;
      } else {
        await db.insert(contentItems).values({
          sourceId,
          externalId: videoId,
          title: metadata.title,
          author: metadata.author,
          contentText: transcript,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        });
        result.itemsNew++;
      }
    } catch (e) {
      result.itemsFailed++;
      result.errors.push(`Failed to process video ${videoId}: ${e}`);
    }
  }

  return result;
}

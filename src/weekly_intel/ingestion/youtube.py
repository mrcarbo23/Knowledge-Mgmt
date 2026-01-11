"""YouTube transcript ingestor."""

import hashlib
import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

from weekly_intel.database import ContentItem, get_session
from weekly_intel.ingestion.base import BaseIngestor, ContentData, IngestResult

logger = logging.getLogger(__name__)


class YouTubeIngestor(BaseIngestor):
    """Ingestor for YouTube video transcripts."""

    source_type = "youtube"

    def validate_config(self) -> list[str]:
        """Validate YouTube configuration."""
        errors = []

        has_channel = self.config.get("channel_id") or self.config.get("channel_url")
        has_playlist = self.config.get("playlist_id") or self.config.get("playlist_url")
        has_videos = self.config.get("video_urls") or self.config.get("video_ids")

        if not (has_channel or has_playlist or has_videos):
            errors.append(
                "YouTube source requires one of: channel_id, channel_url, "
                "playlist_id, playlist_url, video_urls, or video_ids"
            )

        return errors

    def _extract_video_id(self, url: str) -> Optional[str]:
        """Extract video ID from various YouTube URL formats."""
        # Handle different URL formats
        patterns = [
            r"(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})",
            r"(?:embed/)([a-zA-Z0-9_-]{11})",
            r"(?:shorts/)([a-zA-Z0-9_-]{11})",
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)

        return None

    def _extract_channel_id(self, url: str) -> Optional[str]:
        """Extract channel ID from URL."""
        # Handle /channel/CHANNEL_ID format
        match = re.search(r"/channel/([a-zA-Z0-9_-]+)", url)
        if match:
            return match.group(1)

        # Handle /@username format - would need API call to resolve
        # For now, return None and let the user provide channel_id directly
        return None

    def _extract_playlist_id(self, url: str) -> Optional[str]:
        """Extract playlist ID from URL."""
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        return params.get("list", [None])[0]

    def _get_video_ids(self) -> list[str]:
        """Get list of video IDs to process."""
        video_ids = []

        # Direct video IDs
        if self.config.get("video_ids"):
            video_ids.extend(self.config["video_ids"])

        # Video URLs
        if self.config.get("video_urls"):
            for url in self.config["video_urls"]:
                vid = self._extract_video_id(url)
                if vid:
                    video_ids.append(vid)

        # Playlist (requires scraping or API)
        playlist_id = self.config.get("playlist_id")
        if not playlist_id and self.config.get("playlist_url"):
            playlist_id = self._extract_playlist_id(self.config["playlist_url"])

        if playlist_id:
            playlist_videos = self._fetch_playlist_videos(playlist_id)
            video_ids.extend(playlist_videos)

        # Channel (requires scraping or API)
        channel_id = self.config.get("channel_id")
        if not channel_id and self.config.get("channel_url"):
            channel_id = self._extract_channel_id(self.config["channel_url"])

        if channel_id:
            channel_videos = self._fetch_channel_videos(channel_id)
            video_ids.extend(channel_videos)

        # Deduplicate while preserving order
        seen = set()
        unique_ids = []
        for vid in video_ids:
            if vid not in seen:
                seen.add(vid)
                unique_ids.append(vid)

        # Apply limit
        max_videos = self.config.get("max_videos", 20)
        return unique_ids[:max_videos]

    def _fetch_playlist_videos(self, playlist_id: str) -> list[str]:
        """Fetch video IDs from a playlist using web scraping."""
        logger.info(f"Fetching playlist: {playlist_id}")

        # Use YouTube's oembed/API-less approach
        # This is a simplified version - in production you'd use the Data API
        url = f"https://www.youtube.com/playlist?list={playlist_id}"

        try:
            with httpx.Client(timeout=30) as client:
                response = client.get(url)
                response.raise_for_status()

                # Extract video IDs from the page
                video_ids = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', response.text)
                unique_ids = list(dict.fromkeys(video_ids))  # Deduplicate preserving order

                logger.info(f"Found {len(unique_ids)} videos in playlist")
                return unique_ids[:50]  # Limit

        except Exception as e:
            logger.error(f"Failed to fetch playlist: {e}")
            return []

    def _fetch_channel_videos(self, channel_id: str) -> list[str]:
        """Fetch recent video IDs from a channel."""
        logger.info(f"Fetching channel: {channel_id}")

        # Use RSS feed for channel videos (doesn't require API key)
        rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"

        try:
            import feedparser

            feed = feedparser.parse(rss_url)
            video_ids = []

            for entry in feed.entries:
                # Extract video ID from entry link
                vid = self._extract_video_id(entry.get("link", ""))
                if vid:
                    video_ids.append(vid)

            logger.info(f"Found {len(video_ids)} videos from channel RSS")
            return video_ids

        except Exception as e:
            logger.error(f"Failed to fetch channel: {e}")
            return []

    def _fetch_transcript(self, video_id: str) -> Optional[str]:
        """Fetch transcript for a video."""
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

            # Prefer manual transcripts, fallback to auto-generated
            transcript = None
            try:
                transcript = transcript_list.find_manually_created_transcript(["en"])
            except NoTranscriptFound:
                try:
                    transcript = transcript_list.find_generated_transcript(["en"])
                except NoTranscriptFound:
                    # Try any available transcript
                    for t in transcript_list:
                        transcript = t
                        break

            if transcript:
                transcript_data = transcript.fetch()
                # Combine all text segments
                text = " ".join(segment["text"] for segment in transcript_data)
                return text

        except TranscriptsDisabled:
            logger.warning(f"Transcripts disabled for video {video_id}")
        except Exception as e:
            logger.warning(f"Failed to get transcript for {video_id}: {e}")

        return None

    def _fetch_video_metadata(self, video_id: str) -> dict:
        """Fetch video metadata using oembed."""
        try:
            url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            with httpx.Client(timeout=10) as client:
                response = client.get(url)
                if response.status_code == 200:
                    return response.json()
        except Exception as e:
            logger.warning(f"Failed to get metadata for {video_id}: {e}")

        return {}

    def fetch_items(self) -> list[ContentData]:
        """Fetch video transcripts."""
        video_ids = self._get_video_ids()
        logger.info(f"Processing {len(video_ids)} videos")

        items = []
        for video_id in video_ids:
            # Get transcript
            transcript = self._fetch_transcript(video_id)
            if not transcript:
                logger.info(f"Skipping {video_id} - no transcript available")
                continue

            # Get metadata
            metadata = self._fetch_video_metadata(video_id)

            items.append(
                ContentData(
                    external_id=video_id,
                    title=metadata.get("title", f"Video {video_id}"),
                    author=metadata.get("author_name"),
                    content_text=transcript,
                    content_html=None,
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    published_at=None,  # oembed doesn't provide publish date
                )
            )

        logger.info(f"Successfully fetched {len(items)} video transcripts")
        return items

    def ingest(self) -> IngestResult:
        """Ingest YouTube video transcripts."""
        result = IngestResult(source_id=self.source_id)

        # Validate config
        errors = self.validate_config()
        if errors:
            result.errors = errors
            return result

        try:
            items = self.fetch_items()
            result.items_found = len(items)
        except Exception as e:
            logger.error(f"Failed to fetch YouTube: {e}")
            result.errors.append(f"Failed to fetch YouTube: {e}")
            return result

        # Store items in database
        with get_session() as session:
            for item in items:
                try:
                    existing = (
                        session.query(ContentItem)
                        .filter_by(source_id=self.source_id, external_id=item.external_id)
                        .first()
                    )

                    if existing:
                        result.items_skipped += 1
                        continue

                    content_item = ContentItem(
                        source_id=self.source_id,
                        external_id=item.external_id,
                        title=item.title,
                        author=item.author,
                        content_text=item.content_text,
                        content_html=item.content_html,
                        url=item.url,
                        published_at=item.published_at,
                    )
                    session.add(content_item)
                    result.items_new += 1

                except Exception as e:
                    logger.error(f"Failed to store item {item.external_id}: {e}")
                    result.items_failed += 1
                    result.errors.append(f"Failed to store {item.title}: {e}")

        logger.info(
            f"YouTube ingestion complete: {result.items_new} new, "
            f"{result.items_skipped} skipped, {result.items_failed} failed"
        )
        return result

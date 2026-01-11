"""Substack RSS/Atom feed ingestor."""

import hashlib
import logging
import ssl
import urllib.request
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Optional

import certifi
import feedparser
from bs4 import BeautifulSoup

from weekly_intel.database import ContentItem, get_session
from weekly_intel.ingestion.base import BaseIngestor, ContentData, IngestResult

logger = logging.getLogger(__name__)


class SubstackIngestor(BaseIngestor):
    """Ingestor for Substack RSS/Atom feeds."""

    source_type = "substack"

    def validate_config(self) -> list[str]:
        """Validate Substack configuration."""
        errors = []
        if not self.config.get("url"):
            errors.append("Substack source requires 'url' in config")
        return errors

    def fetch_items(self) -> list[ContentData]:
        """Fetch items from the RSS feed."""
        url = self.config["url"]
        logger.info(f"Fetching Substack feed: {url}")

        # Create SSL context with certifi certificates
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        handlers = [urllib.request.HTTPSHandler(context=ssl_context)]
        feed = feedparser.parse(url, handlers=handlers)

        if feed.bozo and feed.bozo_exception:
            logger.warning(f"Feed parsing warning: {feed.bozo_exception}")

        items = []
        for entry in feed.entries:
            content_data = self._parse_entry(entry)
            if content_data:
                items.append(content_data)

        logger.info(f"Found {len(items)} items in feed")
        return items

    def _parse_entry(self, entry) -> Optional[ContentData]:
        """Parse a feed entry into ContentData."""
        # Get unique ID (prefer guid, fallback to link hash)
        external_id = entry.get("id") or entry.get("guid")
        if not external_id:
            link = entry.get("link", "")
            external_id = hashlib.sha256(link.encode()).hexdigest()[:64]

        # Get title
        title = entry.get("title", "Untitled")

        # Get author
        author = None
        if "author" in entry:
            author = entry.author
        elif "authors" in entry and entry.authors:
            author = entry.authors[0].get("name")
        elif hasattr(entry, "author_detail"):
            author = entry.author_detail.get("name")

        # Get content (prefer full content, fallback to summary)
        content_html = None
        content_text = None

        if "content" in entry and entry.content:
            content_html = entry.content[0].get("value", "")
        elif "summary" in entry:
            content_html = entry.summary

        if content_html:
            content_text = self._html_to_text(content_html)

        # Get URL
        url = entry.get("link")

        # Get published date
        published_at = None
        if "published_parsed" in entry and entry.published_parsed:
            try:
                published_at = datetime(*entry.published_parsed[:6])
            except (TypeError, ValueError):
                pass
        elif "published" in entry:
            try:
                published_at = parsedate_to_datetime(entry.published)
            except (TypeError, ValueError):
                pass
        elif "updated_parsed" in entry and entry.updated_parsed:
            try:
                published_at = datetime(*entry.updated_parsed[:6])
            except (TypeError, ValueError):
                pass

        return ContentData(
            external_id=external_id,
            title=title,
            author=author,
            content_text=content_text,
            content_html=content_html,
            url=url,
            published_at=published_at,
        )

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove script and style elements
        for element in soup(["script", "style"]):
            element.decompose()

        # Get text with some spacing
        text = soup.get_text(separator=" ", strip=True)

        # Normalize whitespace
        text = " ".join(text.split())

        return text

    def _is_after_since_date(self, published_at: Optional[datetime]) -> bool:
        """Check if published_at is on or after since_date."""
        if not self.since_date:
            return True
        if not published_at:
            # If no publish date, include by default (can't filter)
            return True
        # Handle timezone-aware vs naive comparison
        since = self.since_date
        pub = published_at
        if pub.tzinfo is not None and since.tzinfo is None:
            pub = pub.replace(tzinfo=None)
        elif pub.tzinfo is None and since.tzinfo is not None:
            since = since.replace(tzinfo=None)
        return pub >= since

    def ingest(self) -> IngestResult:
        """Ingest content from the Substack feed."""
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
            logger.error(f"Failed to fetch feed: {e}")
            result.errors.append(f"Failed to fetch feed: {e}")
            return result

        # Filter by since_date if provided
        if self.since_date:
            items = [item for item in items if self._is_after_since_date(item.published_at)]
            logger.info(f"Filtered to {len(items)} items after {self.since_date.date()}")

        # Store items in database
        with get_session() as session:
            for item in items:
                try:
                    # Check if item already exists
                    existing = (
                        session.query(ContentItem)
                        .filter_by(source_id=self.source_id, external_id=item.external_id)
                        .first()
                    )

                    if existing:
                        if self.force:
                            # Update existing item
                            existing.title = item.title
                            existing.author = item.author
                            existing.content_text = item.content_text
                            existing.content_html = item.content_html
                            existing.url = item.url
                            existing.published_at = item.published_at
                            result.items_updated += 1
                        else:
                            result.items_skipped += 1
                        continue

                    # Create new content item
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
            f"Ingestion complete: {result.items_new} new, {result.items_updated} updated, "
            f"{result.items_skipped} skipped, {result.items_failed} failed"
        )
        return result

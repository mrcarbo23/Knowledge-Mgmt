"""Weekly digest generation using Claude for synthesis."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import anthropic

from weekly_intel.config import get_config
from weekly_intel.database import (
    ClusterMember,
    ContentItem,
    ProcessedItem,
    Source,
    StoryCluster,
    WeeklyDigest,
    get_session,
)
from weekly_intel.digest.html import render_html_email
from weekly_intel.digest.markdown import render_markdown

logger = logging.getLogger(__name__)


@dataclass
class ThemeContent:
    """Content for a single theme in the digest."""

    name: str
    synthesized_summary: str
    sources: list[str]  # Source names
    source_urls: list[str]  # URLs
    is_novel: bool = True
    is_followup: bool = False


@dataclass
class HotTake:
    """A hot take or contrarian view."""

    take: str
    source: str
    author: str
    assessment: str


@dataclass
class SourceSummary:
    """Summary of a content source."""

    name: str
    source_type: str
    item_count: int


@dataclass
class DigestContent:
    """Complete digest content."""

    week_number: str
    date_range: str
    sources_count: int
    items_count: int
    executive_summary: list[str]
    themes: list[ThemeContent]
    hot_takes: list[HotTake]
    signals_to_watch: list[str]
    source_index: list[SourceSummary]
    generated_at: datetime = field(default_factory=datetime.utcnow)


SYNTHESIS_TOOLS = [
    {
        "name": "create_digest",
        "description": "Create the digest content",
        "input_schema": {
            "type": "object",
            "properties": {
                "executive_summary": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3-5 key bullet points summarizing the most important items",
                },
                "signals_to_watch": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Emerging trends or data points worth monitoring",
                },
            },
            "required": ["executive_summary", "signals_to_watch"],
        },
    }
]

CLUSTER_SYNTHESIS_TOOLS = [
    {
        "name": "synthesize_cluster",
        "description": "Synthesize a story cluster",
        "input_schema": {
            "type": "object",
            "properties": {
                "theme_name": {
                    "type": "string",
                    "description": "Short name for this theme/story (3-6 words)",
                },
                "synthesized_summary": {
                    "type": "string",
                    "description": "Synthesized summary incorporating unique details from all sources. Format: 'According to [Source A], [key point]. [Source B] adds that [additional detail].'",
                },
            },
            "required": ["theme_name", "synthesized_summary"],
        },
    }
]


class DigestGenerator:
    """Generate weekly intelligence digests."""

    def __init__(self):
        self.config = get_config()
        api_key = self.config.api_keys.anthropic
        if not api_key:
            raise ValueError("Anthropic API key not configured")

        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = self.config.processing.model
        self.prompts = self.config.prompts.synthesis

    def generate(self, week_number: Optional[str] = None) -> DigestContent:
        """Generate a weekly digest.

        Args:
            week_number: Week to generate for (YYYY-WW), defaults to current week

        Returns:
            DigestContent with all digest data
        """
        if week_number is None:
            week_number = datetime.utcnow().strftime("%Y-%W")

        logger.info(f"Generating digest for week {week_number}")

        # Calculate date range
        year, week = map(int, week_number.split("-"))
        # First day of the week (Monday)
        first_day = datetime.strptime(f"{year}-W{week:02d}-1", "%Y-W%W-%w")
        last_day = first_day + timedelta(days=6)
        date_range = f"{first_day.strftime('%b %d')} - {last_day.strftime('%b %d, %Y')}"

        with get_session() as session:
            # Get processed items for this week
            week_start = first_day
            week_end = last_day + timedelta(days=1)

            processed_items = (
                session.query(ProcessedItem)
                .join(ContentItem)
                .filter(
                    ContentItem.published_at >= week_start,
                    ContentItem.published_at < week_end,
                )
                .all()
            )

            if not processed_items:
                # Try getting items by ingestion date if no published dates
                processed_items = (
                    session.query(ProcessedItem)
                    .join(ContentItem)
                    .filter(
                        ContentItem.ingested_at >= week_start,
                        ContentItem.ingested_at < week_end,
                    )
                    .all()
                )

            if not processed_items:
                logger.warning(f"No processed items found for week {week_number}")
                return DigestContent(
                    week_number=week_number,
                    date_range=date_range,
                    sources_count=0,
                    items_count=0,
                    executive_summary=["No content processed this week."],
                    themes=[],
                    hot_takes=[],
                    signals_to_watch=[],
                    source_index=[],
                )

            logger.info(f"Found {len(processed_items)} processed items")

            # Get clusters for this week
            clusters = (
                session.query(StoryCluster)
                .filter(StoryCluster.week_number == week_number)
                .all()
            )

            # Build source index
            source_counts = {}
            for item in processed_items:
                source = session.query(Source).get(item.content_item.source_id)
                if source:
                    key = (source.name, source.source_type)
                    source_counts[key] = source_counts.get(key, 0) + 1

            source_index = [
                SourceSummary(name=name, source_type=stype, item_count=count)
                for (name, stype), count in sorted(source_counts.items())
            ]

            # Synthesize clusters into themes
            themes = []
            clustered_item_ids = set()

            for cluster in clusters:
                theme = self._synthesize_cluster(session, cluster)
                if theme:
                    themes.append(theme)
                    for member in cluster.members:
                        clustered_item_ids.add(member.processed_item_id)

            # Add unclustered items as individual themes
            for item in processed_items:
                if item.id not in clustered_item_ids:
                    source = session.query(Source).get(item.content_item.source_id)
                    themes.append(
                        ThemeContent(
                            name=self._generate_theme_name(item.summary),
                            synthesized_summary=item.summary,
                            sources=[source.name if source else "Unknown"],
                            source_urls=[item.content_item.url or ""],
                            is_novel=True,
                            is_followup="[Follow-up story]" in (item.key_information or []),
                        )
                    )

            # Collect hot takes
            hot_takes = []
            for item in processed_items:
                for take in item.hot_takes or []:
                    source = session.query(Source).get(item.content_item.source_id)
                    hot_takes.append(
                        HotTake(
                            take=take.get("take", ""),
                            source=source.name if source else "Unknown",
                            author=item.content_item.author or "Unknown",
                            assessment=take.get("context", ""),
                        )
                    )

            # Generate executive summary and signals
            exec_summary, signals = self._generate_summary(themes, hot_takes)

            return DigestContent(
                week_number=week_number,
                date_range=date_range,
                sources_count=len(source_index),
                items_count=len(processed_items),
                executive_summary=exec_summary,
                themes=themes,
                hot_takes=hot_takes[:10],  # Limit to top 10
                signals_to_watch=signals,
                source_index=source_index,
            )

    def _synthesize_cluster(self, session, cluster: StoryCluster) -> Optional[ThemeContent]:
        """Synthesize a story cluster into a theme."""
        members = cluster.members
        if not members:
            return None

        # Get all items in cluster
        items = []
        sources = []
        source_urls = []

        for member in members:
            item = member.processed_item
            if item:
                items.append(item)
                source = session.query(Source).get(item.content_item.source_id)
                if source:
                    sources.append(source.name)
                source_urls.append(item.content_item.url or "")

        if not items:
            return None

        # Build prompt for synthesis
        summaries = []
        for item in items:
            source = session.query(Source).get(item.content_item.source_id)
            source_name = source.name if source else "Unknown"
            summaries.append(f"[{source_name}]: {item.summary}")

        prompt = self.prompts.cluster_user_prompt_template.format(
            summaries=chr(10).join(summaries)
        )

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=self.prompts.cluster_system_prompt,
                tools=CLUSTER_SYNTHESIS_TOOLS,
                tool_choice={"type": "tool", "name": "synthesize_cluster"},
                messages=[{"role": "user", "content": prompt}],
            )

            for block in response.content:
                if block.type == "tool_use" and block.name == "synthesize_cluster":
                    data = block.input
                    # Check if any item is a follow-up
                    is_followup = any(
                        "[Follow-up story]" in (item.key_information or [])
                        for item in items
                    )

                    return ThemeContent(
                        name=data.get("theme_name", "Topic"),
                        synthesized_summary=data.get("synthesized_summary", ""),
                        sources=list(set(sources)),
                        source_urls=source_urls,
                        is_novel=not is_followup,
                        is_followup=is_followup,
                    )

        except Exception as e:
            logger.error(f"Failed to synthesize cluster: {e}")

        # Fallback: use canonical item's summary
        canonical = cluster.canonical_item
        if canonical:
            return ThemeContent(
                name=self._generate_theme_name(canonical.summary),
                synthesized_summary=canonical.summary,
                sources=list(set(sources)),
                source_urls=source_urls,
            )

        return None

    def _generate_theme_name(self, summary: str) -> str:
        """Generate a short theme name from a summary."""
        # Simple extraction: first few words or up to first period
        words = summary.split()[:6]
        name = " ".join(words)
        if len(name) > 50:
            name = name[:47] + "..."
        return name

    def _generate_summary(
        self, themes: list[ThemeContent], hot_takes: list[HotTake]
    ) -> tuple[list[str], list[str]]:
        """Generate executive summary and signals to watch."""
        # Build context from themes
        theme_summaries = []
        for theme in themes[:15]:  # Limit context
            novelty = "NEW" if theme.is_novel else "ONGOING"
            theme_summaries.append(f"[{novelty}] {theme.name}: {theme.synthesized_summary[:200]}")

        hot_take_summaries = []
        for take in hot_takes[:5]:
            hot_take_summaries.append(f"- {take.author}: {take.take}")

        prompt = self.prompts.executive_summary_prompt_template.format(
            themes=chr(10).join(theme_summaries),
            hot_takes=chr(10).join(hot_take_summaries) if hot_take_summaries else "None notable",
        )

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=self.prompts.system_prompt,
                tools=SYNTHESIS_TOOLS,
                tool_choice={"type": "tool", "name": "create_digest"},
                messages=[{"role": "user", "content": prompt}],
            )

            for block in response.content:
                if block.type == "tool_use" and block.name == "create_digest":
                    data = block.input
                    return (
                        data.get("executive_summary", []),
                        data.get("signals_to_watch", []),
                    )

        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")

        # Fallback
        return (
            ["Digest generation encountered an error. Review themes below."],
            [],
        )

    def save_digest(self, content: DigestContent) -> tuple[str, str]:
        """Save digest to files and database.

        Args:
            content: DigestContent to save

        Returns:
            Tuple of (markdown_path, html_path)
        """
        output_dir = Path(self.config.output.digest_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate filenames
        md_filename = f"{content.week_number}-digest.md"
        html_filename = f"{content.week_number}-digest.html"

        md_path = output_dir / md_filename
        html_path = output_dir / html_filename

        # Render and save markdown
        md_content = render_markdown(content)
        with open(md_path, "w") as f:
            f.write(md_content)
        logger.info(f"Saved markdown digest to {md_path}")

        # Render and save HTML
        html_content = render_html_email(content)
        with open(html_path, "w") as f:
            f.write(html_content)
        logger.info(f"Saved HTML digest to {html_path}")

        # Save to database
        with get_session() as session:
            existing = (
                session.query(WeeklyDigest)
                .filter_by(week_number=content.week_number)
                .first()
            )

            if existing:
                existing.date_range = content.date_range
                existing.sources_count = content.sources_count
                existing.items_count = content.items_count
                existing.markdown_path = str(md_path)
                existing.html_path = str(html_path)
                existing.generated_at = content.generated_at
            else:
                digest = WeeklyDigest(
                    week_number=content.week_number,
                    date_range=content.date_range,
                    sources_count=content.sources_count,
                    items_count=content.items_count,
                    markdown_path=str(md_path),
                    html_path=str(html_path),
                    generated_at=content.generated_at,
                )
                session.add(digest)

        return str(md_path), str(html_path)

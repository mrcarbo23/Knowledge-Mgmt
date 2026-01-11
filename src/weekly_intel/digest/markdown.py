"""Markdown digest renderer."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from weekly_intel.digest.generator import DigestContent


def render_markdown(content: DigestContent) -> str:
    """Render digest content as Markdown.

    Args:
        content: DigestContent to render

    Returns:
        Markdown string
    """
    lines = []

    # Header
    lines.append("# Weekly Intel Digest")
    lines.append(
        f"**Week of {content.date_range}** | "
        f"{content.sources_count} sources processed | "
        f"{content.items_count} items analyzed"
    )
    lines.append("")

    # Executive Summary
    lines.append("## Executive Summary")
    lines.append("")
    for point in content.executive_summary:
        lines.append(f"- {point}")
    lines.append("")

    # Key Themes
    lines.append("## Key Themes This Week")
    lines.append("")

    for i, theme in enumerate(content.themes, 1):
        # Theme header with novelty indicator
        novelty = "New" if theme.is_novel else "Ongoing story"
        if theme.is_followup:
            novelty = "Follow-up"

        lines.append(f"### {i}. {theme.name}")
        lines.append("")
        lines.append(theme.synthesized_summary)
        lines.append("")

        # Sources
        sources_str = ", ".join(theme.sources)
        lines.append(f"**Sources:** {sources_str}")

        # Novelty indicator
        indicator = "New" if theme.is_novel else "Ongoing story"
        if theme.is_followup:
            indicator = "Follow-up"
        lines.append(f"**Novelty:** {indicator}")
        lines.append("")

    # Hot Takes
    if content.hot_takes:
        lines.append("## Hot Takes & Contrarian Views")
        lines.append("")
        lines.append("| Take | Source | Assessment |")
        lines.append("|------|--------|------------|")

        for take in content.hot_takes:
            # Escape pipe characters in content
            take_text = take.take.replace("|", "\\|")
            source_text = f"{take.author} ({take.source})".replace("|", "\\|")
            assessment_text = take.assessment.replace("|", "\\|")
            lines.append(f"| {take_text} | {source_text} | {assessment_text} |")

        lines.append("")

    # Signals to Watch
    if content.signals_to_watch:
        lines.append("## Signals to Watch")
        lines.append("")
        for signal in content.signals_to_watch:
            lines.append(f"- {signal}")
        lines.append("")

    # Source Index
    if content.source_index:
        lines.append("## Source Index")
        lines.append("")
        lines.append("| Source | Items | Type |")
        lines.append("|--------|-------|------|")

        for source in content.source_index:
            lines.append(f"| {source.name} | {source.item_count} | {source.source_type} |")

        lines.append("")

    # Footer
    lines.append("---")
    timestamp = content.generated_at.strftime("%Y-%m-%d %H:%M UTC")
    lines.append(f"*Generated {timestamp} by Weekly Intel*")

    return "\n".join(lines)

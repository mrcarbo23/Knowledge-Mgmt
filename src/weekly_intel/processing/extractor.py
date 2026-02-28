"""LLM-based content extraction using Claude API."""

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import anthropic

from weekly_intel.config import get_config

logger = logging.getLogger(__name__)


@dataclass
class ExtractionResult:
    """Result of content extraction."""

    summary: str
    key_information: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    hot_takes: list[dict] = field(default_factory=list)  # {take: str, context: str}
    entities: dict = field(default_factory=dict)  # {people: [], companies: [], technologies: []}
    raw_response: Optional[dict] = None


EXTRACTION_TOOLS = [
    {
        "name": "extract_content",
        "description": "Extract structured information from content",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "A concise 2-3 sentence summary of the content",
                },
                "key_information": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of key facts, announcements, or data points",
                },
                "themes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Main themes or topics discussed",
                },
                "hot_takes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "take": {"type": "string", "description": "The contrarian or notable opinion"},
                            "context": {"type": "string", "description": "Brief context about why this is notable"},
                        },
                        "required": ["take", "context"],
                    },
                    "description": "Contrarian views or notable opinions",
                },
                "entities": {
                    "type": "object",
                    "properties": {
                        "people": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "People mentioned",
                        },
                        "companies": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Companies or organizations mentioned",
                        },
                        "technologies": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Technologies, products, or concepts mentioned",
                        },
                    },
                    "description": "Named entities extracted from content",
                },
            },
            "required": ["summary", "key_information", "themes", "entities"],
        },
    }
]


class ContentExtractor:
    """Extract structured information from content using Claude."""

    def __init__(self):
        config = get_config()
        api_key = config.api_keys.anthropic or os.environ.get("ANTHROPIC_API_KEY")

        if not api_key:
            raise ValueError(
                "Anthropic API key not configured. "
                "Set ANTHROPIC_API_KEY environment variable or api_keys.anthropic in config."
            )

        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = config.processing.model
        self.prompts = config.prompts.extraction

    def extract(
        self,
        content: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
        source_type: Optional[str] = None,
    ) -> ExtractionResult:
        """Extract structured information from content.

        Args:
            content: The content text to analyze
            title: Optional title of the content
            author: Optional author name
            source_type: Type of source (substack, gmail, youtube)

        Returns:
            ExtractionResult with extracted information
        """
        # Build context
        context_parts = []
        if title:
            context_parts.append(f"Title: {title}")
        if author:
            context_parts.append(f"Author: {author}")
        if source_type:
            context_parts.append(f"Source type: {source_type}")

        context = "\n".join(context_parts) if context_parts else ""

        # Truncate content if too long (Claude has context limits)
        max_content_length = 50000
        if len(content) > max_content_length:
            content = content[:max_content_length] + "\n[Content truncated...]"

        user_message = self.prompts.user_prompt_template.format(
            context=context, content=content
        )

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=self.prompts.system_prompt,
                tools=EXTRACTION_TOOLS,
                tool_choice={"type": "tool", "name": "extract_content"},
                messages=[{"role": "user", "content": user_message}],
            )

            # Parse tool use response
            for block in response.content:
                if block.type == "tool_use" and block.name == "extract_content":
                    data = block.input
                    return ExtractionResult(
                        summary=data.get("summary", ""),
                        key_information=data.get("key_information", []),
                        themes=data.get("themes", []),
                        hot_takes=data.get("hot_takes", []),
                        entities=data.get("entities", {}),
                        raw_response=data,
                    )

            # Fallback if no tool use found
            logger.warning("No tool use in response, using text content")
            text_content = ""
            for block in response.content:
                if hasattr(block, "text"):
                    text_content += block.text

            return ExtractionResult(
                summary=text_content[:500] if text_content else "Failed to extract summary",
                raw_response={"text": text_content},
            )

        except anthropic.APIError as e:
            logger.error(f"Claude API error: {e}")
            raise

    def extract_batch(
        self,
        items: list[dict],
        batch_size: int = 5,
    ) -> list[ExtractionResult]:
        """Extract from multiple items.

        Args:
            items: List of dicts with 'content', 'title', 'author', 'source_type'
            batch_size: Not used for Claude (no batching), but kept for interface

        Returns:
            List of ExtractionResults
        """
        results = []
        for item in items:
            try:
                result = self.extract(
                    content=item.get("content", ""),
                    title=item.get("title"),
                    author=item.get("author"),
                    source_type=item.get("source_type"),
                )
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to extract from {item.get('title', 'unknown')}: {e}")
                results.append(
                    ExtractionResult(
                        summary=f"Extraction failed: {e}",
                    )
                )

        return results

"""Base class for content ingestors."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class IngestResult:
    """Result of an ingestion operation."""

    source_id: int
    items_found: int = 0
    items_new: int = 0
    items_skipped: int = 0
    items_failed: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class ContentData:
    """Standardized content data from any source."""

    external_id: str
    title: Optional[str] = None
    author: Optional[str] = None
    content_text: Optional[str] = None
    content_html: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[datetime] = None


class BaseIngestor(ABC):
    """Abstract base class for content ingestors."""

    source_type: str = "unknown"

    def __init__(self, source_id: int, config: dict):
        """Initialize the ingestor.

        Args:
            source_id: Database ID of the source
            config: Source-specific configuration dict
        """
        self.source_id = source_id
        self.config = config

    @abstractmethod
    def ingest(self) -> IngestResult:
        """Ingest content from the source.

        Returns:
            IngestResult with counts and any errors
        """
        pass

    @abstractmethod
    def fetch_items(self) -> list[ContentData]:
        """Fetch items from the source.

        Returns:
            List of ContentData objects
        """
        pass

    def validate_config(self) -> list[str]:
        """Validate the source configuration.

        Returns:
            List of validation error messages (empty if valid)
        """
        return []

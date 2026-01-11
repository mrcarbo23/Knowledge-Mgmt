"""Content ingestion module for Weekly Intel."""

from weekly_intel.ingestion.base import BaseIngestor, IngestResult
from weekly_intel.ingestion.gmail import GmailIngestor
from weekly_intel.ingestion.substack import SubstackIngestor
from weekly_intel.ingestion.youtube import YouTubeIngestor

__all__ = [
    "BaseIngestor",
    "IngestResult",
    "SubstackIngestor",
    "GmailIngestor",
    "YouTubeIngestor",
]


def get_ingestor(source_type: str) -> type[BaseIngestor]:
    """Get the ingestor class for a source type."""
    ingestors = {
        "substack": SubstackIngestor,
        "gmail": GmailIngestor,
        "youtube": YouTubeIngestor,
    }
    if source_type not in ingestors:
        raise ValueError(f"Unknown source type: {source_type}")
    return ingestors[source_type]

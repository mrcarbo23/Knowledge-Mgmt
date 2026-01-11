"""Main processing pipeline orchestration."""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np

from weekly_intel.config import get_config
from weekly_intel.database import (
    ClusterMember,
    ContentItem,
    ProcessedItem,
    Source,
    StoryCluster,
    get_session,
)
from weekly_intel.processing.clustering import cluster_items
from weekly_intel.processing.embeddings import get_embedding_model
from weekly_intel.processing.extractor import ContentExtractor
from weekly_intel.processing.fingerprint import (
    are_fingerprints_similar,
    compute_fingerprint,
)
from weekly_intel.processing.novelty import batch_check_novelty

logger = logging.getLogger(__name__)


@dataclass
class ProcessingResult:
    """Result of processing pipeline run."""

    items_processed: int = 0
    items_skipped: int = 0
    items_failed: int = 0
    duplicates_found: int = 0
    clusters_created: int = 0
    errors: list[str] = field(default_factory=list)


class ProcessingPipeline:
    """Main processing pipeline for content analysis."""

    def __init__(self):
        self.config = get_config()
        self.extractor = None  # Lazy load
        self.embedding_model = None  # Lazy load

    def _get_extractor(self) -> ContentExtractor:
        """Get or create content extractor."""
        if self.extractor is None:
            self.extractor = ContentExtractor()
        return self.extractor

    def _get_embedding_model(self):
        """Get or create embedding model."""
        if self.embedding_model is None:
            self.embedding_model = get_embedding_model()
        return self.embedding_model

    def process_new_items(self, week_number: Optional[str] = None) -> ProcessingResult:
        """Process all unprocessed content items.

        Args:
            week_number: Optional week number for clustering (YYYY-WW)

        Returns:
            ProcessingResult with counts and errors
        """
        result = ProcessingResult()

        if week_number is None:
            week_number = datetime.utcnow().strftime("%Y-%W")

        with get_session() as session:
            # Get unprocessed items
            unprocessed = (
                session.query(ContentItem)
                .outerjoin(ProcessedItem)
                .filter(ProcessedItem.id.is_(None))
                .all()
            )

            if not unprocessed:
                logger.info("No unprocessed items found")
                return result

            logger.info(f"Found {len(unprocessed)} unprocessed items")

            # Step 1: Compute fingerprints for deduplication
            logger.info("Computing fingerprints...")
            for item in unprocessed:
                if item.content_text and not item.fingerprint:
                    item.fingerprint = compute_fingerprint(item.content_text)

            session.commit()

            # Step 2: Check for near-duplicates
            logger.info("Checking for duplicates...")
            duplicates = self._find_duplicates(unprocessed)
            result.duplicates_found = len(duplicates)

            # Skip duplicate items (keep the earliest one)
            skip_ids = set()
            for dup_group in duplicates:
                # Sort by published_at, keep earliest
                sorted_group = sorted(
                    dup_group,
                    key=lambda x: x.published_at or datetime.max,
                )
                # Skip all but the first
                for item in sorted_group[1:]:
                    skip_ids.add(item.id)
                    logger.info(f"Skipping duplicate: {item.title}")

            # Step 3: Process each item
            items_to_process = [i for i in unprocessed if i.id not in skip_ids]
            logger.info(f"Processing {len(items_to_process)} items...")

            processed_items = []
            extractor = self._get_extractor()
            embedding_model = self._get_embedding_model()

            for item in items_to_process:
                try:
                    # Get source type
                    source = session.query(Source).get(item.source_id)
                    source_type = source.source_type if source else None

                    # Extract information using Claude
                    extraction = extractor.extract(
                        content=item.content_text or "",
                        title=item.title,
                        author=item.author,
                        source_type=source_type,
                    )

                    # Compute embedding of summary
                    embedding = embedding_model.encode(extraction.summary)
                    embedding_bytes = embedding_model.embedding_to_bytes(embedding)

                    # Create processed item
                    processed = ProcessedItem(
                        content_item_id=item.id,
                        summary=extraction.summary,
                        key_information=extraction.key_information,
                        themes=extraction.themes,
                        hot_takes=extraction.hot_takes,
                        entities=extraction.entities,
                        embedding=embedding_bytes,
                    )
                    session.add(processed)
                    session.flush()  # Get the ID

                    processed_items.append((processed, embedding))
                    result.items_processed += 1

                    logger.info(f"Processed: {item.title}")

                except Exception as e:
                    logger.error(f"Failed to process {item.title}: {e}")
                    result.items_failed += 1
                    result.errors.append(f"Failed to process {item.title}: {e}")

            result.items_skipped = len(skip_ids)

            # Commit all processed items
            session.commit()

            # Step 4: Check novelty
            if processed_items:
                logger.info("Checking novelty...")
                novelty_items = [(p.id, emb) for p, emb in processed_items]
                novelty_results = batch_check_novelty(novelty_items)

                # Update items with novelty info (stored in key_information)
                for processed, _ in processed_items:
                    novelty = novelty_results.get(processed.id)
                    if novelty:
                        info = processed.key_information or []
                        if novelty.is_followup:
                            info.append("[Follow-up story]")
                        processed.key_information = info

                session.commit()

            # Step 5: Create story clusters
            if processed_items:
                logger.info("Creating story clusters...")
                clusters_created = self._create_clusters(
                    session,
                    processed_items,
                    week_number,
                )
                result.clusters_created = clusters_created

        logger.info(
            f"Processing complete: {result.items_processed} processed, "
            f"{result.items_skipped} skipped, {result.items_failed} failed, "
            f"{result.clusters_created} clusters created"
        )

        return result

    def _find_duplicates(self, items: list[ContentItem]) -> list[list[ContentItem]]:
        """Find groups of duplicate items based on fingerprints."""
        threshold = self.config.processing.fingerprint_threshold
        duplicate_groups = []
        processed = set()

        for i, item1 in enumerate(items):
            if item1.id in processed or not item1.fingerprint:
                continue

            group = [item1]
            processed.add(item1.id)

            for j, item2 in enumerate(items):
                if i >= j or item2.id in processed or not item2.fingerprint:
                    continue

                is_similar = are_fingerprints_similar(
                    item1.fingerprint,
                    item2.fingerprint,
                    threshold=threshold,
                )

                if is_similar:
                    group.append(item2)
                    processed.add(item2.id)

            if len(group) > 1:
                duplicate_groups.append(group)

        return duplicate_groups

    def _create_clusters(
        self,
        session,
        processed_items: list[tuple[ProcessedItem, np.ndarray]],
        week_number: str,
    ) -> int:
        """Create story clusters from processed items."""
        if len(processed_items) < 2:
            return 0

        # Get embeddings
        embeddings = np.array([emb for _, emb in processed_items])
        items = [p for p, _ in processed_items]

        # Cluster
        clustering_result = cluster_items(embeddings, min_cluster_size=2)

        clusters_created = 0
        for cluster in clustering_result.clusters:
            if len(cluster.item_indices) < 2:
                continue

            # Get the canonical item (representative)
            canonical_idx = cluster.representative_idx
            canonical_item = items[canonical_idx]

            # Create cluster record
            story_cluster = StoryCluster(
                week_number=week_number,
                canonical_item_id=canonical_item.id,
            )
            session.add(story_cluster)
            session.flush()

            # Add members
            for idx in cluster.item_indices:
                item = items[idx]
                member = ClusterMember(
                    cluster_id=story_cluster.id,
                    processed_item_id=item.id,
                    similarity_score=1.0 if idx == canonical_idx else 0.9,
                )
                session.add(member)

            clusters_created += 1

        session.commit()
        return clusters_created

    def reprocess_all(self, week_number: Optional[str] = None) -> ProcessingResult:
        """Delete all processed items and reprocess everything.

        Args:
            week_number: Week number for clustering

        Returns:
            ProcessingResult
        """
        logger.warning("Reprocessing all items - this will delete existing data")

        with get_session() as session:
            # Delete in correct order (foreign keys)
            session.query(ClusterMember).delete()
            session.query(StoryCluster).delete()
            session.query(ProcessedItem).delete()
            session.commit()

        return self.process_new_items(week_number)

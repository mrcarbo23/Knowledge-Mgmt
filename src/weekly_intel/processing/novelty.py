"""Historical novelty checking for content items."""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from weekly_intel.config import get_config
from weekly_intel.database import ProcessedItem, get_session
from weekly_intel.processing.embeddings import (
    cosine_similarity,
    get_embedding_model,
)

logger = logging.getLogger(__name__)


@dataclass
class NoveltyResult:
    """Result of novelty check."""

    is_novel: bool
    novelty_score: float  # 0-1, higher = more novel
    similar_items: list[dict]  # [{id, title, similarity, week_number}]
    is_followup: bool  # Is this a follow-up to a previous story?


def check_novelty(
    processed_item_id: int,
    embedding: np.ndarray,
    weeks_back: Optional[int] = None,
    threshold: Optional[float] = None,
) -> NoveltyResult:
    """Check if a processed item is novel compared to historical content.

    Args:
        processed_item_id: ID of the processed item to check
        embedding: Embedding vector of the item's summary
        weeks_back: Number of weeks to look back (default from config)
        threshold: Similarity threshold above which items are considered similar

    Returns:
        NoveltyResult with novelty assessment
    """
    config = get_config()
    weeks_back = weeks_back or config.processing.novelty_weeks
    threshold = threshold or config.processing.semantic_threshold

    cutoff_date = datetime.utcnow() - timedelta(weeks=weeks_back)

    similar_items = []
    max_similarity = 0.0

    with get_session() as session:
        # Get historical processed items
        historical = (
            session.query(ProcessedItem)
            .filter(
                ProcessedItem.id != processed_item_id,
                ProcessedItem.processed_at >= cutoff_date,
                ProcessedItem.embedding.isnot(None),
            )
            .all()
        )

        if not historical:
            logger.info("No historical items to compare against")
            return NoveltyResult(
                is_novel=True,
                novelty_score=1.0,
                similar_items=[],
                is_followup=False,
            )

        embedding_model = get_embedding_model()

        for item in historical:
            # Load embedding from bytes
            item_embedding = embedding_model.bytes_to_embedding(item.embedding)

            similarity = cosine_similarity(embedding, item_embedding)

            if similarity >= threshold:
                # Get week number from processed_at
                week_number = item.processed_at.strftime("%Y-%W")

                # Get title from content item
                title = None
                if item.content_item:
                    title = item.content_item.title

                similar_items.append(
                    {
                        "id": item.id,
                        "title": title,
                        "similarity": float(similarity),
                        "week_number": week_number,
                    }
                )

            max_similarity = max(max_similarity, similarity)

    # Sort by similarity descending
    similar_items.sort(key=lambda x: x["similarity"], reverse=True)

    # Limit to top 5 similar items
    similar_items = similar_items[:5]

    # Determine novelty
    is_novel = max_similarity < threshold
    novelty_score = 1.0 - max_similarity  # Higher = more novel

    # Check if this is a follow-up (similar to very recent content)
    is_followup = False
    if similar_items:
        # Check if similar item is from last week
        one_week_ago = datetime.utcnow() - timedelta(weeks=1)
        current_week = datetime.utcnow().strftime("%Y-%W")
        last_week = one_week_ago.strftime("%Y-%W")

        for item in similar_items:
            if item["week_number"] in (current_week, last_week) and item["similarity"] >= 0.7:
                is_followup = True
                break

    logger.info(
        f"Novelty check: novel={is_novel}, score={novelty_score:.3f}, "
        f"similar_count={len(similar_items)}, followup={is_followup}"
    )

    return NoveltyResult(
        is_novel=is_novel,
        novelty_score=novelty_score,
        similar_items=similar_items,
        is_followup=is_followup,
    )


def batch_check_novelty(
    items: list[tuple[int, np.ndarray]],
    weeks_back: Optional[int] = None,
    threshold: Optional[float] = None,
) -> dict[int, NoveltyResult]:
    """Check novelty for multiple items efficiently.

    Args:
        items: List of (processed_item_id, embedding) tuples
        weeks_back: Number of weeks to look back
        threshold: Similarity threshold

    Returns:
        Dict mapping processed_item_id to NoveltyResult
    """
    config = get_config()
    weeks_back = weeks_back or config.processing.novelty_weeks
    threshold = threshold or config.processing.semantic_threshold

    cutoff_date = datetime.utcnow() - timedelta(weeks=weeks_back)
    item_ids = [item_id for item_id, _ in items]

    results = {}

    with get_session() as session:
        # Get all historical processed items at once
        historical = (
            session.query(ProcessedItem)
            .filter(
                ProcessedItem.id.notin_(item_ids),
                ProcessedItem.processed_at >= cutoff_date,
                ProcessedItem.embedding.isnot(None),
            )
            .all()
        )

        if not historical:
            # All items are novel
            for item_id, _ in items:
                results[item_id] = NoveltyResult(
                    is_novel=True,
                    novelty_score=1.0,
                    similar_items=[],
                    is_followup=False,
                )
            return results

        # Load historical embeddings
        embedding_model = get_embedding_model()
        historical_embeddings = []
        historical_metadata = []

        for item in historical:
            emb = embedding_model.bytes_to_embedding(item.embedding)
            historical_embeddings.append(emb)
            historical_metadata.append(
                {
                    "id": item.id,
                    "title": item.content_item.title if item.content_item else None,
                    "week_number": item.processed_at.strftime("%Y-%W"),
                }
            )

        historical_matrix = np.array(historical_embeddings)

        # Normalize for cosine similarity
        historical_norms = np.linalg.norm(historical_matrix, axis=1, keepdims=True)
        historical_norms[historical_norms == 0] = 1
        historical_normalized = historical_matrix / historical_norms

        # Process each item
        for item_id, embedding in items:
            # Normalize item embedding
            norm = np.linalg.norm(embedding)
            if norm == 0:
                norm = 1
            normalized = embedding / norm

            # Compute similarities
            similarities = np.dot(historical_normalized, normalized)

            # Find similar items
            similar_items = []
            max_similarity = 0.0

            for idx, sim in enumerate(similarities):
                if sim >= threshold:
                    meta = historical_metadata[idx]
                    similar_items.append(
                        {
                            "id": meta["id"],
                            "title": meta["title"],
                            "similarity": float(sim),
                            "week_number": meta["week_number"],
                        }
                    )
                max_similarity = max(max_similarity, float(sim))

            similar_items.sort(key=lambda x: x["similarity"], reverse=True)
            similar_items = similar_items[:5]

            is_novel = max_similarity < threshold
            novelty_score = 1.0 - max_similarity

            # Check for follow-up
            is_followup = False
            current_week = datetime.utcnow().strftime("%Y-%W")
            last_week = (datetime.utcnow() - timedelta(weeks=1)).strftime("%Y-%W")

            for item in similar_items:
                if item["week_number"] in (current_week, last_week) and item["similarity"] >= 0.7:
                    is_followup = True
                    break

            results[item_id] = NoveltyResult(
                is_novel=is_novel,
                novelty_score=novelty_score,
                similar_items=similar_items,
                is_followup=is_followup,
            )

    return results

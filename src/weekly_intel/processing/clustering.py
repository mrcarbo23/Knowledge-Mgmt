"""Story clustering using HDBSCAN."""

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from weekly_intel.config import get_config
from weekly_intel.processing.embeddings import cosine_similarity_matrix

logger = logging.getLogger(__name__)


@dataclass
class Cluster:
    """A cluster of related items."""

    id: int
    item_indices: list[int] = field(default_factory=list)
    centroid: Optional[np.ndarray] = None
    representative_idx: Optional[int] = None  # Index of most central item


@dataclass
class ClusteringResult:
    """Result of clustering operation."""

    clusters: list[Cluster]
    labels: np.ndarray  # Cluster label for each item (-1 = noise)
    noise_indices: list[int]  # Indices of unclustered items


def cluster_items(
    embeddings: np.ndarray,
    min_cluster_size: int = 2,
    min_samples: int = 1,
    cluster_selection_epsilon: float = 0.0,
) -> ClusteringResult:
    """Cluster items based on their embeddings using HDBSCAN.

    Args:
        embeddings: Array of shape (n_items, dimension)
        min_cluster_size: Minimum number of items to form a cluster
        min_samples: HDBSCAN min_samples parameter
        cluster_selection_epsilon: HDBSCAN cluster_selection_epsilon

    Returns:
        ClusteringResult with clusters and labels
    """
    if len(embeddings) < min_cluster_size:
        logger.info(f"Not enough items ({len(embeddings)}) for clustering")
        return ClusteringResult(
            clusters=[],
            labels=np.array([-1] * len(embeddings)),
            noise_indices=list(range(len(embeddings))),
        )

    logger.info(f"Clustering {len(embeddings)} items")

    try:
        import hdbscan

        # HDBSCAN works better with L2 distance on normalized vectors
        # Normalize embeddings
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normalized = embeddings / norms

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            cluster_selection_epsilon=cluster_selection_epsilon,
            metric="euclidean",
        )

        labels = clusterer.fit_predict(normalized)

    except ImportError:
        logger.warning("HDBSCAN not available, falling back to threshold-based clustering")
        labels = _threshold_clustering(embeddings)

    # Build cluster objects
    clusters = []
    unique_labels = set(labels)
    unique_labels.discard(-1)  # Remove noise label

    for cluster_id in sorted(unique_labels):
        indices = np.where(labels == cluster_id)[0].tolist()

        # Compute centroid
        cluster_embeddings = embeddings[indices]
        centroid = np.mean(cluster_embeddings, axis=0)

        # Find representative (closest to centroid)
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        representative_idx = indices[np.argmin(distances)]

        clusters.append(
            Cluster(
                id=int(cluster_id),
                item_indices=indices,
                centroid=centroid,
                representative_idx=representative_idx,
            )
        )

    noise_indices = np.where(labels == -1)[0].tolist()

    logger.info(
        f"Found {len(clusters)} clusters, {len(noise_indices)} noise items"
    )

    return ClusteringResult(
        clusters=clusters,
        labels=labels,
        noise_indices=noise_indices,
    )


def _threshold_clustering(
    embeddings: np.ndarray,
    threshold: float = 0.85,
) -> np.ndarray:
    """Simple threshold-based clustering fallback.

    Groups items with cosine similarity above threshold.
    """
    config = get_config()
    threshold = config.processing.semantic_threshold

    n = len(embeddings)
    labels = np.full(n, -1, dtype=int)

    # Compute similarity matrix
    sim_matrix = cosine_similarity_matrix(embeddings)

    current_label = 0
    for i in range(n):
        if labels[i] != -1:
            continue

        # Start new cluster with this item
        labels[i] = current_label
        cluster_indices = [i]

        # Find all items similar to any cluster member
        for j in range(i + 1, n):
            if labels[j] != -1:
                continue

            # Check similarity to any cluster member
            max_sim = max(sim_matrix[j, idx] for idx in cluster_indices)
            if max_sim >= threshold:
                labels[j] = current_label
                cluster_indices.append(j)

        # Only keep cluster if it has multiple items
        if len(cluster_indices) == 1:
            labels[i] = -1
        else:
            current_label += 1

    return labels


def merge_clusters(
    clusters: list[Cluster],
    embeddings: np.ndarray,
    merge_threshold: float = 0.9,
) -> list[Cluster]:
    """Merge clusters whose centroids are very similar.

    Args:
        clusters: List of clusters to potentially merge
        embeddings: Original embeddings array
        merge_threshold: Similarity threshold for merging

    Returns:
        Merged list of clusters
    """
    if len(clusters) <= 1:
        return clusters

    # Compute centroid similarities
    centroids = np.array([c.centroid for c in clusters])
    sim_matrix = cosine_similarity_matrix(centroids)

    # Find clusters to merge (greedy)
    merged = [False] * len(clusters)
    result = []

    for i in range(len(clusters)):
        if merged[i]:
            continue

        # Start with this cluster
        merged_indices = [i]
        merged[i] = True

        # Find clusters to merge with
        for j in range(i + 1, len(clusters)):
            if merged[j]:
                continue
            if sim_matrix[i, j] >= merge_threshold:
                merged_indices.append(j)
                merged[j] = True

        # Create merged cluster
        all_item_indices = []
        for idx in merged_indices:
            all_item_indices.extend(clusters[idx].item_indices)

        cluster_embeddings = embeddings[all_item_indices]
        centroid = np.mean(cluster_embeddings, axis=0)

        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        representative_idx = all_item_indices[np.argmin(distances)]

        result.append(
            Cluster(
                id=len(result),
                item_indices=all_item_indices,
                centroid=centroid,
                representative_idx=representative_idx,
            )
        )

    return result

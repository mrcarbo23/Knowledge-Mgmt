"""Processing pipeline module for Weekly Intel."""

from weekly_intel.processing.clustering import cluster_items
from weekly_intel.processing.embeddings import EmbeddingModel, get_embedding_model
from weekly_intel.processing.extractor import ContentExtractor
from weekly_intel.processing.fingerprint import compute_fingerprint, are_near_duplicates
from weekly_intel.processing.novelty import check_novelty
from weekly_intel.processing.pipeline import ProcessingPipeline

__all__ = [
    "ProcessingPipeline",
    "ContentExtractor",
    "EmbeddingModel",
    "get_embedding_model",
    "compute_fingerprint",
    "are_near_duplicates",
    "cluster_items",
    "check_novelty",
]

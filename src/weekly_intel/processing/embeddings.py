"""Embedding generation using sentence-transformers."""

import logging
from typing import Optional

import numpy as np

from weekly_intel.config import get_config

logger = logging.getLogger(__name__)

# Singleton model instance
_model: Optional["EmbeddingModel"] = None


class EmbeddingModel:
    """Wrapper for sentence-transformers embedding model."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """Initialize the embedding model.

        Args:
            model_name: Name of the sentence-transformers model to use
        """
        self.model_name = model_name
        self._model = None
        self._dimension = None

    def _load_model(self):
        """Lazy load the model."""
        if self._model is None:
            logger.info(f"Loading embedding model: {self.model_name}")
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
            self._dimension = self._model.get_sentence_embedding_dimension()
            logger.info(f"Model loaded. Embedding dimension: {self._dimension}")

    @property
    def dimension(self) -> int:
        """Get the embedding dimension."""
        self._load_model()
        return self._dimension

    def encode(self, text: str) -> np.ndarray:
        """Encode a single text into an embedding vector.

        Args:
            text: Text to encode

        Returns:
            numpy array of shape (dimension,)
        """
        self._load_model()
        return self._model.encode(text, convert_to_numpy=True)

    def encode_batch(self, texts: list[str], batch_size: int = 32) -> np.ndarray:
        """Encode multiple texts into embedding vectors.

        Args:
            texts: List of texts to encode
            batch_size: Batch size for encoding

        Returns:
            numpy array of shape (len(texts), dimension)
        """
        self._load_model()
        return self._model.encode(texts, batch_size=batch_size, convert_to_numpy=True)

    def embedding_to_bytes(self, embedding: np.ndarray) -> bytes:
        """Convert embedding array to bytes for database storage.

        Args:
            embedding: numpy array

        Returns:
            bytes representation
        """
        return embedding.astype(np.float32).tobytes()

    def bytes_to_embedding(self, data: bytes) -> np.ndarray:
        """Convert bytes from database to embedding array.

        Args:
            data: bytes from database

        Returns:
            numpy array
        """
        return np.frombuffer(data, dtype=np.float32)


def get_embedding_model() -> EmbeddingModel:
    """Get the singleton embedding model instance."""
    global _model
    if _model is None:
        config = get_config()
        _model = EmbeddingModel(model_name=config.processing.embedding_model)
    return _model


def compute_embedding(text: str) -> np.ndarray:
    """Compute embedding for a single text.

    Args:
        text: Text to embed

    Returns:
        Embedding vector as numpy array
    """
    model = get_embedding_model()
    return model.encode(text)


def compute_embeddings_batch(texts: list[str]) -> np.ndarray:
    """Compute embeddings for multiple texts.

    Args:
        texts: List of texts

    Returns:
        Array of embeddings, shape (len(texts), dimension)
    """
    model = get_embedding_model()
    return model.encode_batch(texts)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors.

    Args:
        a: First vector
        b: Second vector

    Returns:
        Cosine similarity score (-1 to 1)
    """
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return float(np.dot(a, b) / (norm_a * norm_b))


def cosine_similarity_matrix(embeddings: np.ndarray) -> np.ndarray:
    """Compute pairwise cosine similarity matrix.

    Args:
        embeddings: Array of shape (n, dimension)

    Returns:
        Similarity matrix of shape (n, n)
    """
    # Normalize
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1  # Avoid division by zero
    normalized = embeddings / norms

    # Compute similarity matrix
    return np.dot(normalized, normalized.T)

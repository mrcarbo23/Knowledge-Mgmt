"""Content fingerprinting using MinHash for near-duplicate detection."""

import json
import logging
import re
from typing import Optional

from datasketch import MinHash

logger = logging.getLogger(__name__)

# MinHash configuration
NUM_PERMUTATIONS = 128
DEFAULT_THRESHOLD = 0.8


def tokenize(text: str) -> list[str]:
    """Tokenize text into shingles (word n-grams).

    Uses 3-word shingles for better duplicate detection.
    """
    if not text:
        return []

    # Normalize text
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)  # Remove punctuation
    text = re.sub(r"\s+", " ", text).strip()  # Normalize whitespace

    words = text.split()

    # Create 3-word shingles
    shingle_size = 3
    if len(words) < shingle_size:
        return words

    shingles = []
    for i in range(len(words) - shingle_size + 1):
        shingle = " ".join(words[i : i + shingle_size])
        shingles.append(shingle)

    return shingles


def compute_minhash(text: str) -> MinHash:
    """Compute MinHash signature for text."""
    mh = MinHash(num_perm=NUM_PERMUTATIONS)

    tokens = tokenize(text)
    for token in tokens:
        mh.update(token.encode("utf-8"))

    return mh


def compute_fingerprint(text: str) -> str:
    """Compute a fingerprint string for text.

    Returns a JSON-encoded representation of the MinHash signature
    that can be stored in the database.
    """
    if not text:
        return ""

    mh = compute_minhash(text)

    # Store as list of hash values
    fingerprint_data = {
        "version": 1,
        "num_perm": NUM_PERMUTATIONS,
        "hashvalues": mh.hashvalues.tolist(),
    }

    return json.dumps(fingerprint_data)


def load_fingerprint(fingerprint_str: str) -> Optional[MinHash]:
    """Load a MinHash from a fingerprint string."""
    if not fingerprint_str:
        return None

    try:
        data = json.loads(fingerprint_str)

        if data.get("version") != 1:
            logger.warning(f"Unknown fingerprint version: {data.get('version')}")
            return None

        mh = MinHash(num_perm=data["num_perm"])
        mh.hashvalues[:] = data["hashvalues"]

        return mh

    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.error(f"Failed to load fingerprint: {e}")
        return None


def compute_similarity(text1: str, text2: str) -> float:
    """Compute Jaccard similarity between two texts using MinHash."""
    mh1 = compute_minhash(text1)
    mh2 = compute_minhash(text2)

    return mh1.jaccard(mh2)


def compute_similarity_from_fingerprints(fp1: str, fp2: str) -> Optional[float]:
    """Compute similarity from stored fingerprint strings."""
    mh1 = load_fingerprint(fp1)
    mh2 = load_fingerprint(fp2)

    if mh1 is None or mh2 is None:
        return None

    return mh1.jaccard(mh2)


def are_near_duplicates(
    text1: str, text2: str, threshold: float = DEFAULT_THRESHOLD
) -> bool:
    """Check if two texts are near-duplicates.

    Args:
        text1: First text
        text2: Second text
        threshold: Jaccard similarity threshold (default 0.8)

    Returns:
        True if similarity >= threshold
    """
    similarity = compute_similarity(text1, text2)
    return similarity >= threshold


def are_fingerprints_similar(
    fp1: str, fp2: str, threshold: float = DEFAULT_THRESHOLD
) -> Optional[bool]:
    """Check if two fingerprints represent similar content.

    Args:
        fp1: First fingerprint string
        fp2: Second fingerprint string
        threshold: Jaccard similarity threshold

    Returns:
        True if similar, False if not, None if fingerprints invalid
    """
    similarity = compute_similarity_from_fingerprints(fp1, fp2)
    if similarity is None:
        return None
    return similarity >= threshold


def find_duplicates(
    texts: list[str], threshold: float = DEFAULT_THRESHOLD
) -> list[tuple[int, int, float]]:
    """Find all near-duplicate pairs in a list of texts.

    Args:
        texts: List of text strings
        threshold: Similarity threshold

    Returns:
        List of (index1, index2, similarity) tuples
    """
    # Compute all MinHashes
    minhashes = [compute_minhash(text) for text in texts]

    duplicates = []
    for i in range(len(minhashes)):
        for j in range(i + 1, len(minhashes)):
            similarity = minhashes[i].jaccard(minhashes[j])
            if similarity >= threshold:
                duplicates.append((i, j, similarity))

    return duplicates

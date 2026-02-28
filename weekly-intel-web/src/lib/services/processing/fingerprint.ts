const NUM_PERMUTATIONS = 128;
const LARGE_PRIME = 2147483647; // 2^31 - 1 (Mersenne prime)
const MAX_HASH = (1 << 31) - 1;

// Pre-generated permutation coefficients (a, b) for MinHash
// Uses random-looking but deterministic values for reproducibility
function getPermutations(): Array<[number, number]> {
  const perms: Array<[number, number]> = [];
  let seed = 42;
  for (let i = 0; i < NUM_PERMUTATIONS; i++) {
    seed = (seed * 6364136223846793005 + 1) & MAX_HASH;
    const a = (seed & MAX_HASH) | 1; // ensure odd
    seed = (seed * 6364136223846793005 + 1) & MAX_HASH;
    const b = seed & MAX_HASH;
    perms.push([a, b]);
  }
  return perms;
}

const PERMUTATIONS = getPermutations();

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash >>> 0; // Convert to unsigned 32-bit
}

function tokenize(text: string): string[] {
  if (!text) return [];

  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ");
  const shingleSize = 3;

  if (words.length < shingleSize) return words;

  const shingles: string[] = [];
  for (let i = 0; i <= words.length - shingleSize; i++) {
    shingles.push(words.slice(i, i + shingleSize).join(" "));
  }
  return shingles;
}

function computeMinHashValues(text: string): number[] {
  const tokens = tokenize(text);
  const hashValues = new Array(NUM_PERMUTATIONS).fill(Infinity);

  for (const token of tokens) {
    const h = simpleHash(token);
    for (let i = 0; i < NUM_PERMUTATIONS; i++) {
      const [a, b] = PERMUTATIONS[i];
      const permHash = ((a * h + b) % LARGE_PRIME) >>> 0;
      if (permHash < hashValues[i]) {
        hashValues[i] = permHash;
      }
    }
  }

  return hashValues;
}

export function computeFingerprint(text: string): string {
  if (!text) return "";

  const hashValues = computeMinHashValues(text);
  return JSON.stringify({
    version: 1,
    num_perm: NUM_PERMUTATIONS,
    hashvalues: hashValues,
  });
}

export function computeSimilarityFromFingerprints(
  fp1: string,
  fp2: string
): number | null {
  if (!fp1 || !fp2) return null;

  try {
    const data1 = JSON.parse(fp1);
    const data2 = JSON.parse(fp2);

    if (data1.version !== 1 || data2.version !== 1) return null;

    const hv1: number[] = data1.hashvalues;
    const hv2: number[] = data2.hashvalues;

    if (hv1.length !== hv2.length) return null;

    let matches = 0;
    for (let i = 0; i < hv1.length; i++) {
      if (hv1[i] === hv2[i]) matches++;
    }

    return matches / hv1.length;
  } catch {
    return null;
  }
}

export function areFingerprintsSimilar(
  fp1: string,
  fp2: string,
  threshold = 0.8
): boolean | null {
  const sim = computeSimilarityFromFingerprints(fp1, fp2);
  if (sim === null) return null;
  return sim >= threshold;
}

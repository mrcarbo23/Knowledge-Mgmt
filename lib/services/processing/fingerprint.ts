// Pure TypeScript MinHash implementation for content fingerprinting

const NUM_PERM = 128;
const LARGE_PRIME = 2147483647; // 2^31 - 1
const SEED = 42;

// Generate deterministic coefficients using LCG
function generateCoefficients(): { a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];

  let state = SEED;
  const lcg = () => {
    state = ((state * 1103515245 + 12345) & 0x7fffffff) >>> 0;
    return state;
  };

  for (let i = 0; i < NUM_PERM; i++) {
    a.push((lcg() % (LARGE_PRIME - 1)) + 1);
    b.push(lcg() % LARGE_PRIME);
  }

  return { a, b };
}

const { a: COEFF_A, b: COEFF_B } = generateCoefficients();

// DJB2 hash variant
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Tokenize text into 3-word shingles
function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const shingles: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) {
    shingles.push(words.slice(i, i + 3).join(" "));
  }

  return shingles;
}

export interface Fingerprint {
  version: number;
  num_perm: number;
  hashvalues: number[];
}

export function computeFingerprint(text: string): string {
  const shingles = tokenize(text);

  if (shingles.length === 0) {
    // Return empty fingerprint for very short texts
    return JSON.stringify({
      version: 1,
      num_perm: NUM_PERM,
      hashvalues: new Array(NUM_PERM).fill(LARGE_PRIME),
    });
  }

  // Initialize with max values
  const hashvalues = new Array(NUM_PERM).fill(LARGE_PRIME);

  // For each shingle
  for (const shingle of shingles) {
    const h = simpleHash(shingle);

    // For each permutation, compute min hash
    for (let i = 0; i < NUM_PERM; i++) {
      const permHash = (((COEFF_A[i] * h + COEFF_B[i]) % LARGE_PRIME) >>> 0);
      if (permHash < hashvalues[i]) {
        hashvalues[i] = permHash;
      }
    }
  }

  const fingerprint: Fingerprint = {
    version: 1,
    num_perm: NUM_PERM,
    hashvalues,
  };

  return JSON.stringify(fingerprint);
}

export function computeSimilarityFromFingerprints(
  fp1: string,
  fp2: string
): number {
  try {
    const f1: Fingerprint = JSON.parse(fp1);
    const f2: Fingerprint = JSON.parse(fp2);

    if (f1.num_perm !== f2.num_perm) {
      throw new Error("Fingerprints have different number of permutations");
    }

    let matches = 0;
    for (let i = 0; i < f1.num_perm; i++) {
      if (f1.hashvalues[i] === f2.hashvalues[i]) {
        matches++;
      }
    }

    return matches / f1.num_perm;
  } catch {
    return 0;
  }
}

export function areFingerprintsSimilar(
  fp1: string,
  fp2: string,
  threshold: number
): boolean {
  return computeSimilarityFromFingerprints(fp1, fp2) >= threshold;
}

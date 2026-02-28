import { config } from "@/lib/config";
import { cosineSimilarityMatrix } from "./embeddings";

export interface Cluster {
  id: number;
  itemIndices: number[];
  centroid: number[];
  representativeIdx: number;
}

export interface ClusteringResult {
  clusters: Cluster[];
  labels: number[]; // -1 = noise
  noiseIndices: number[];
}

export function clusterItems(
  embeddings: number[][],
  minClusterSize = 2
): ClusteringResult {
  if (embeddings.length < minClusterSize) {
    return {
      clusters: [],
      labels: new Array(embeddings.length).fill(-1),
      noiseIndices: Array.from({ length: embeddings.length }, (_, i) => i),
    };
  }

  // Use threshold-based clustering (replaces HDBSCAN)
  const labels = thresholdClustering(embeddings, config.semanticThreshold);

  // Build cluster objects
  const clusters: Cluster[] = [];
  const uniqueLabels = new Set(labels);
  uniqueLabels.delete(-1);

  for (const clusterId of [...uniqueLabels].sort()) {
    const indices = labels
      .map((label, idx) => (label === clusterId ? idx : -1))
      .filter((idx) => idx !== -1);

    // Compute centroid
    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);
    for (const idx of indices) {
      for (let d = 0; d < dim; d++) {
        centroid[d] += embeddings[idx][d];
      }
    }
    for (let d = 0; d < dim; d++) {
      centroid[d] /= indices.length;
    }

    // Find representative (closest to centroid)
    let minDist = Infinity;
    let representativeIdx = indices[0];
    for (const idx of indices) {
      let dist = 0;
      for (let d = 0; d < dim; d++) {
        const diff = embeddings[idx][d] - centroid[d];
        dist += diff * diff;
      }
      if (dist < minDist) {
        minDist = dist;
        representativeIdx = idx;
      }
    }

    clusters.push({
      id: clusterId,
      itemIndices: indices,
      centroid,
      representativeIdx,
    });
  }

  const noiseIndices = labels
    .map((label, idx) => (label === -1 ? idx : -1))
    .filter((idx) => idx !== -1);

  return { clusters, labels, noiseIndices };
}

function thresholdClustering(
  embeddings: number[][],
  threshold: number
): number[] {
  const n = embeddings.length;
  const labels = new Array(n).fill(-1);

  // Compute similarity matrix
  const simMatrix = cosineSimilarityMatrix(embeddings);

  let currentLabel = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;

    labels[i] = currentLabel;
    const clusterIndices = [i];

    for (let j = i + 1; j < n; j++) {
      if (labels[j] !== -1) continue;

      // Check similarity to any cluster member
      let maxSim = 0;
      for (const idx of clusterIndices) {
        maxSim = Math.max(maxSim, simMatrix[j][idx]);
      }

      if (maxSim >= threshold) {
        labels[j] = currentLabel;
        clusterIndices.push(j);
      }
    }

    // Only keep cluster if it has multiple items
    if (clusterIndices.length === 1) {
      labels[i] = -1;
    } else {
      currentLabel++;
    }
  }

  return labels;
}

export function mergeClusters(
  clusters: Cluster[],
  embeddings: number[][],
  mergeThreshold = 0.9
): Cluster[] {
  if (clusters.length <= 1) return clusters;

  const centroids = clusters.map((c) => c.centroid);
  const simMatrix = cosineSimilarityMatrix(centroids);

  const merged = new Array(clusters.length).fill(false);
  const result: Cluster[] = [];

  for (let i = 0; i < clusters.length; i++) {
    if (merged[i]) continue;

    const mergedIndices = [i];
    merged[i] = true;

    for (let j = i + 1; j < clusters.length; j++) {
      if (merged[j]) continue;
      if (simMatrix[i][j] >= mergeThreshold) {
        mergedIndices.push(j);
        merged[j] = true;
      }
    }

    // Create merged cluster
    const allItemIndices: number[] = [];
    for (const idx of mergedIndices) {
      allItemIndices.push(...clusters[idx].itemIndices);
    }

    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);
    for (const idx of allItemIndices) {
      for (let d = 0; d < dim; d++) {
        centroid[d] += embeddings[idx][d];
      }
    }
    for (let d = 0; d < dim; d++) {
      centroid[d] /= allItemIndices.length;
    }

    let minDist = Infinity;
    let representativeIdx = allItemIndices[0];
    for (const idx of allItemIndices) {
      let dist = 0;
      for (let d = 0; d < dim; d++) {
        const diff = embeddings[idx][d] - centroid[d];
        dist += diff * diff;
      }
      if (dist < minDist) {
        minDist = dist;
        representativeIdx = idx;
      }
    }

    result.push({
      id: result.length,
      itemIndices: allItemIndices,
      centroid,
      representativeIdx,
    });
  }

  return result;
}

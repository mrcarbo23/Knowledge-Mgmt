import { cosineSimilarityMatrix, cosineSimilarity } from "./embeddings";

export interface Cluster {
  indices: number[];
  centroid: number[];
  representativeIdx: number;
}

export interface ClusteringResult {
  clusters: Cluster[];
  labels: number[]; // cluster index for each item, -1 for noise
  noiseIndices: number[];
}

// Threshold-based clustering (serverless-friendly alternative to HDBSCAN)
export function clusterItems(
  embeddings: number[][],
  threshold: number
): ClusteringResult {
  const n = embeddings.length;
  const labels = new Array(n).fill(-1);
  const clusters: Cluster[] = [];

  if (n === 0) {
    return { clusters: [], labels: [], noiseIndices: [] };
  }

  if (n === 1) {
    return { clusters: [], labels: [-1], noiseIndices: [0] };
  }

  // Compute similarity matrix
  const simMatrix = cosineSimilarityMatrix(embeddings);

  // Track assigned items
  const assigned = new Set<number>();

  // Iterate through items and form clusters
  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue;

    // Start a new potential cluster
    const clusterMembers = [i];
    assigned.add(i);

    // Find all items similar to any cluster member
    for (let j = i + 1; j < n; j++) {
      if (assigned.has(j)) continue;

      // Check if item j is similar to any existing cluster member
      let maxSim = 0;
      for (const memberIdx of clusterMembers) {
        maxSim = Math.max(maxSim, simMatrix[memberIdx][j]);
      }

      if (maxSim >= threshold) {
        clusterMembers.push(j);
        assigned.add(j);
      }
    }

    // Only keep clusters with 2+ items
    if (clusterMembers.length >= 2) {
      const clusterIdx = clusters.length;

      // Compute centroid
      const centroid = new Array(embeddings[0].length).fill(0);
      for (const idx of clusterMembers) {
        for (let k = 0; k < centroid.length; k++) {
          centroid[k] += embeddings[idx][k];
        }
      }
      for (let k = 0; k < centroid.length; k++) {
        centroid[k] /= clusterMembers.length;
      }

      // Find representative (closest to centroid)
      let representativeIdx = clusterMembers[0];
      let maxSimToCentroid = -1;
      for (const idx of clusterMembers) {
        const sim = cosineSimilarity(embeddings[idx], centroid);
        if (sim > maxSimToCentroid) {
          maxSimToCentroid = sim;
          representativeIdx = idx;
        }
      }

      // Assign labels
      for (const idx of clusterMembers) {
        labels[idx] = clusterIdx;
      }

      clusters.push({
        indices: clusterMembers,
        centroid,
        representativeIdx,
      });
    } else {
      // Single item - mark as noise but unassign for potential later clustering
      assigned.delete(i);
    }
  }

  // Mark remaining unassigned items as noise
  const noiseIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (labels[i] === -1) {
      noiseIndices.push(i);
    }
  }

  return { clusters, labels, noiseIndices };
}

// Merge similar clusters
export function mergeClusters(
  result: ClusteringResult,
  embeddings: number[][],
  mergeThreshold: number
): ClusteringResult {
  const { clusters, labels, noiseIndices } = result;

  if (clusters.length < 2) {
    return result;
  }

  // Check which clusters should be merged
  const mergeGroups: number[][] = [];
  const processed = new Set<number>();

  for (let i = 0; i < clusters.length; i++) {
    if (processed.has(i)) continue;

    const group = [i];
    processed.add(i);

    for (let j = i + 1; j < clusters.length; j++) {
      if (processed.has(j)) continue;

      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
      if (sim >= mergeThreshold) {
        group.push(j);
        processed.add(j);
      }
    }

    mergeGroups.push(group);
  }

  // Build merged clusters
  const newClusters: Cluster[] = [];
  const newLabels = [...labels];

  for (const group of mergeGroups) {
    const newClusterIdx = newClusters.length;

    // Collect all members
    const allIndices: number[] = [];
    for (const clusterIdx of group) {
      allIndices.push(...clusters[clusterIdx].indices);
    }

    // Compute new centroid
    const centroid = new Array(embeddings[0].length).fill(0);
    for (const idx of allIndices) {
      for (let k = 0; k < centroid.length; k++) {
        centroid[k] += embeddings[idx][k];
      }
    }
    for (let k = 0; k < centroid.length; k++) {
      centroid[k] /= allIndices.length;
    }

    // Find new representative
    let representativeIdx = allIndices[0];
    let maxSim = -1;
    for (const idx of allIndices) {
      const sim = cosineSimilarity(embeddings[idx], centroid);
      if (sim > maxSim) {
        maxSim = sim;
        representativeIdx = idx;
      }
    }

    // Update labels
    for (const idx of allIndices) {
      newLabels[idx] = newClusterIdx;
    }

    newClusters.push({
      indices: allIndices,
      centroid,
      representativeIdx,
    });
  }

  return { clusters: newClusters, labels: newLabels, noiseIndices };
}

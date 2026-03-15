/**
 * Pure functions for mesh construction from depth data.
 * Extracted from ImageProcessor for Web Worker compatibility.
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
  triangleCount: number;
}

/**
 * Erode a binary mask by `radius` pixels to remove fringing at object edges.
 */
export function erodeMask(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < 128) continue;
      let ok = true;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mask[ny * width + nx] < 128) { ok = false; break outer; }
        }
      }
      if (ok) output[y * width + x] = 255;
    }
  }
  return output;
}

/**
 * Return a copy of the mask with only the largest 4-connected foreground region kept.
 */
export function largestConnectedComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const label = new Int32Array(mask.length).fill(-1);
  let bestId = -1, bestSize = 0;
  let id = 0;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] < 128 || label[start] !== -1) continue;

    const queue: number[] = [start];
    label[start] = id;
    let head = 0, size = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      size++;
      const x = idx % width, y = (idx - x) / width;
      const neighbors = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && mask[n] >= 128 && label[n] === -1) {
          label[n] = id;
          queue.push(n);
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }

  const output = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (label[i] === bestId) output[i] = 255;
  }
  return output;
}

/**
 * Replaces depth values at the foreground-background boundary with the
 * average depth of interior (non-boundary) foreground pixels.
 */
function healDepthBoundary(
  depth: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  searchRadius = 4
): Uint8Array {
  const interior = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] < 128) continue;
      let ok = true;
      outer: for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mask[ny * width + nx] < 128) { ok = false; break outer; }
        }
      }
      if (ok) interior[i] = 1;
    }
  }

  const output = new Uint8Array(depth);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] < 128 || interior[i]) continue;

      let sum = 0, count = 0;
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (interior[ni]) { sum += depth[ni]; count++; }
        }
      }
      if (count > 0) output[i] = Math.round(sum / count);
    }
  }
  return output;
}

function shouldEmitTriangle(
  i0: number, i1: number, i2: number,
  d0: number, d1: number, d2: number,
  mask: Uint8Array | null,
  depthThreshold: number
): boolean {
  if (mask) {
    if (mask[i0] < 128 || mask[i1] < 128 || mask[i2] < 128) return false;
  }
  if (Math.abs(d0 - d1) > depthThreshold) return false;
  if (Math.abs(d1 - d2) > depthThreshold) return false;
  if (Math.abs(d0 - d2) > depthThreshold) return false;
  return true;
}

/**
 * Build a triangle mesh from depth data with optional foreground mask and surface normals.
 */
export function buildMeshData(
  depthData: Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array | null,
  depthScale = 1.5,
  shellThickness = 0.3,
  normalData: Float32Array | null = null
): MeshData {
  const numVertices = width * height;
  const requiredBytes = numVertices * 2 * (3 + 3 + 2) * 4;
  if (requiredBytes > 2_000_000_000) {
    throw new RangeError(`Mesh requires ~${(requiredBytes / 1e9).toFixed(1)} GB — reduce image resolution.`);
  }

  if (mask) {
    mask = erodeMask(mask, width, height, 1);
    mask = largestConnectedComponent(mask, width, height);
    depthData = healDepthBoundary(depthData, mask, width, height);
  }

  let dMin = 255, dMax = 0;
  for (let i = 0; i < depthData.length; i++) {
    if (mask && mask[i] < 128) continue;
    if (depthData[i] < dMin) dMin = depthData[i];
    if (depthData[i] > dMax) dMax = depthData[i];
  }
  const dRange = Math.max(dMax - dMin, 1);
  const DEPTH_THRESHOLD = dRange * 0.35;

  const scale = 2.0 / Math.max(width, height);

  // Front surface vertices + normals
  const frontPositions = new Float32Array(numVertices * 3);
  const frontNormals = new Float32Array(numVertices * 3);
  const frontUvs = new Float32Array(numVertices * 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const i3 = i * 3;
      const i2 = i * 2;
      frontPositions[i3] = (x - width / 2) * scale;
      frontPositions[i3 + 1] = -(y - height / 2) * scale;
      frontPositions[i3 + 2] = ((depthData[i] - dMin) / dRange) * depthScale;
      frontUvs[i2] = x / (width - 1);
      frontUvs[i2 + 1] = y / (height - 1);

      // Per-vertex normals from normal map or default
      if (normalData) {
        frontNormals[i3] = normalData[i3];
        frontNormals[i3 + 1] = normalData[i3 + 1];
        frontNormals[i3 + 2] = normalData[i3 + 2];
      } else {
        frontNormals[i3] = 0;
        frontNormals[i3 + 1] = 0;
        frontNormals[i3 + 2] = 1;
      }
    }
  }

  // Front surface triangles
  const maxFrontTriangles = (width - 1) * (height - 1) * 2;
  const frontIndices = new Uint32Array(maxFrontTriangles * 3);
  let frontTriCount = 0;

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = y * width + x;
      const tr = tl + 1;
      const bl = (y + 1) * width + x;
      const br = bl + 1;

      const dTL = depthData[tl];
      const dTR = depthData[tr];
      const dBL = depthData[bl];
      const dBR = depthData[br];

      if (shouldEmitTriangle(tl, bl, tr, dTL, dBL, dTR, mask, DEPTH_THRESHOLD)) {
        const idx = frontTriCount * 3;
        frontIndices[idx] = tl;
        frontIndices[idx + 1] = bl;
        frontIndices[idx + 2] = tr;
        frontTriCount++;
      }

      if (shouldEmitTriangle(tr, bl, br, dTR, dBL, dBR, mask, DEPTH_THRESHOLD)) {
        const idx = frontTriCount * 3;
        frontIndices[idx] = tr;
        frontIndices[idx + 1] = bl;
        frontIndices[idx + 2] = br;
        frontTriCount++;
      }
    }
  }

  // Find boundary edges
  const edgeCounts = new Map<string, number>();
  const edgeKey = (a: number, b: number) => `${Math.min(a, b)},${Math.max(a, b)}`;

  for (let t = 0; t < frontTriCount; t++) {
    const base = t * 3;
    const v0 = frontIndices[base], v1 = frontIndices[base + 1], v2 = frontIndices[base + 2];
    for (const k of [edgeKey(v0, v1), edgeKey(v1, v2), edgeKey(v2, v0)]) {
      edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
    }
  }

  const boundaryEdges: [number, number][] = [];
  for (const [k, count] of edgeCounts) {
    if (count === 1) {
      const [a, b] = k.split(',').map(Number);
      boundaryEdges.push([a, b]);
    }
  }

  // Build combined mesh: front + back + side skirt
  const skirtVertexCount = boundaryEdges.length * 4;
  const totalVertices = numVertices * 2 + skirtVertexCount;
  const backTriCount = frontTriCount;
  const skirtTriCount = boundaryEdges.length * 2;
  const totalTriCount = frontTriCount + backTriCount + skirtTriCount;

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const indices = new Uint32Array(totalTriCount * 3);

  // Front surface
  positions.set(frontPositions);
  normals.set(frontNormals);
  uvs.set(frontUvs);

  // Back surface — flat Z offset (normals used for lighting only, not geometry)
  const backOffset = numVertices;
  for (let i = 0; i < numVertices; i++) {
    const i3 = i * 3;
    const bi3 = (i + backOffset) * 3;
    const bi2 = (i + backOffset) * 2;

    positions[bi3] = frontPositions[i3];
    positions[bi3 + 1] = frontPositions[i3 + 1];
    positions[bi3 + 2] = frontPositions[i3 + 2] - shellThickness;

    // Back normals point inward (inverted front normals for smooth shading)
    normals[bi3] = -frontNormals[i3];
    normals[bi3 + 1] = -frontNormals[i3 + 1];
    normals[bi3 + 2] = -frontNormals[i3 + 2];

    uvs[bi2] = frontUvs[i * 2];
    uvs[bi2 + 1] = frontUvs[i * 2 + 1];
  }

  // Front indices
  let idxOffset = 0;
  for (let i = 0; i < frontTriCount * 3; i++) {
    indices[i] = frontIndices[i];
  }
  idxOffset = frontTriCount * 3;

  // Back indices (reversed winding)
  for (let t = 0; t < frontTriCount; t++) {
    const src = t * 3;
    const dst = idxOffset + t * 3;
    indices[dst] = frontIndices[src] + backOffset;
    indices[dst + 1] = frontIndices[src + 2] + backOffset;
    indices[dst + 2] = frontIndices[src + 1] + backOffset;
  }
  idxOffset += backTriCount * 3;

  // Side skirt connecting front and back boundary edges
  const skirtBaseVertex = numVertices * 2;
  for (let e = 0; e < boundaryEdges.length; e++) {
    const [a, b] = boundaryEdges[e];
    const sv = skirtBaseVertex + e * 4;

    // 4 vertices per skirt quad: frontA, frontB, backA, backB
    for (let c = 0; c < 4; c++) {
      const srcIdx = c < 2 ? (c === 0 ? a : b) : (c === 2 ? a : b);
      const isBack = c >= 2;
      const srcBase = srcIdx * 3;
      const dstV = sv + c;

      positions[dstV * 3] = frontPositions[srcBase];
      positions[dstV * 3 + 1] = frontPositions[srcBase + 1];
      positions[dstV * 3 + 2] = frontPositions[srcBase + 2] - (isBack ? shellThickness : 0);

      // Skirt normal: outward-facing perpendicular to edge
      const ex = frontPositions[b * 3] - frontPositions[a * 3];
      const ey = frontPositions[b * 3 + 1] - frontPositions[a * 3 + 1];
      // Cross with Z-axis to get outward direction in XY plane
      const len2d = Math.sqrt(ex * ex + ey * ey);
      if (len2d > 0) {
        normals[dstV * 3] = ey / len2d;
        normals[dstV * 3 + 1] = -ex / len2d;
        normals[dstV * 3 + 2] = 0;
      } else {
        normals[dstV * 3] = 0;
        normals[dstV * 3 + 1] = 0;
        normals[dstV * 3 + 2] = -1;
      }

      uvs[dstV * 2] = frontUvs[srcIdx * 2];
      uvs[dstV * 2 + 1] = frontUvs[srcIdx * 2 + 1];
    }

    const qi = idxOffset + e * 6;
    indices[qi] = sv;
    indices[qi + 1] = sv + 1;
    indices[qi + 2] = sv + 2;
    indices[qi + 3] = sv + 2;
    indices[qi + 4] = sv + 1;
    indices[qi + 5] = sv + 3;
  }

  return {
    positions,
    normals,
    indices,
    uvs,
    vertexCount: totalVertices,
    triangleCount: totalTriCount,
  };
}

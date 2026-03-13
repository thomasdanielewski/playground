export interface ProcessedImage {
  url: string;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  wasDownscaled: boolean;
  scaleFactor: number;
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
  triangleCount: number;
}

const DEFAULT_MAX_PIXELS = 1_000_000;

export class ImageProcessor {
  private maxPixels: number;

  constructor(maxPixels: number = DEFAULT_MAX_PIXELS) {
    this.maxPixels = maxPixels;
  }

  async processImage(file: File): Promise<ProcessedImage> {
    const url = URL.createObjectURL(file);
    try {
      const img = await this.loadImage(url);
      const origW = img.naturalWidth;
      const origH = img.naturalHeight;
      const total = origW * origH;

      if (total <= this.maxPixels) {
        return { url, originalWidth: origW, originalHeight: origH, processedWidth: origW, processedHeight: origH, wasDownscaled: false, scaleFactor: 1 };
      }

      const scaleFactor = Math.sqrt(this.maxPixels / total);
      const pW = Math.floor(origW * scaleFactor);
      const pH = Math.floor(origH * scaleFactor);

      const canvas = document.createElement('canvas');
      canvas.width = pW;
      canvas.height = pH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create 2D canvas context.');
      ctx.drawImage(img, 0, 0, pW, pH);
      const downscaledUrl = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);

      return { url: downscaledUrl, originalWidth: origW, originalHeight: origH, processedWidth: pW, processedHeight: pH, wasDownscaled: true, scaleFactor };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  async extractColors(imageUrl: string, width: number, height: number): Promise<Uint8ClampedArray> {
    const img = await this.loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context.');
    ctx.drawImage(img, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  }

  /**
   * Resize a single-channel mask to target dimensions using nearest-neighbor interpolation.
   */
  resizeMask(mask: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
    if (srcW === dstW && srcH === dstH) return mask;

    const output = new Uint8Array(dstW * dstH);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
      const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
      for (let x = 0; x < dstW; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
        output[y * dstW + x] = mask[srcY * srcW + srcX];
      }
    }

    return output;
  }

  /**
   * Erode a binary mask by `radius` pixels to remove fringing at object edges.
   */
  erodeMask(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
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
   * Eliminates disconnected background fragments that leaked through segmentation.
   */
  largestConnectedComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
    const label = new Int32Array(mask.length).fill(-1);
    let bestId = -1, bestSize = 0;
    let id = 0;

    for (let start = 0; start < mask.length; start++) {
      if (mask[start] < 128 || label[start] !== -1) continue;

      // BFS
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
   * Build a triangle mesh from depth data with optional foreground mask.
   * Skips background triangles and depth-discontinuity triangles.
   */
  buildMeshData(
    depthData: Uint8Array,
    width: number,
    height: number,
    mask: Uint8Array | null,
    depthScale = 1.5,
    shellThickness = 0.15
  ): MeshData {
    const numVertices = width * height;
    // Front + back vertices: rough memory check (positions + uvs, ×2 for shell)
    const requiredBytes = numVertices * 2 * (3 + 2) * 4;
    if (requiredBytes > 2_000_000_000) {
      throw new RangeError(`Mesh requires ~${(requiredBytes / 1e9).toFixed(1)} GB — reduce image resolution.`);
    }

    // Clean up mask: erode edges then keep only the largest connected foreground region.
    // This removes background fringing and disconnected artifact islands (e.g. watermarks).
    if (mask) {
      mask = this.erodeMask(mask, width, height, 2);
      mask = this.largestConnectedComponent(mask, width, height);
    }

    // Adaptive depth normalization: find actual range used by foreground pixels
    let dMin = 255, dMax = 0;
    for (let i = 0; i < depthData.length; i++) {
      if (mask && mask[i] < 128) continue;
      if (depthData[i] < dMin) dMin = depthData[i];
      if (depthData[i] > dMax) dMax = depthData[i];
    }
    const dRange = Math.max(dMax - dMin, 1);
    const DEPTH_THRESHOLD = dRange * 0.12;

    const scale = 2.0 / Math.max(width, height);

    // ── Front surface vertices ──
    const frontPositions = new Float32Array(numVertices * 3);
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
      }
    }

    // ── Front surface triangles ──
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

        if (this.shouldEmitTriangle(tl, bl, tr, dTL, dBL, dTR, mask, DEPTH_THRESHOLD)) {
          const idx = frontTriCount * 3;
          frontIndices[idx] = tl;
          frontIndices[idx + 1] = bl;
          frontIndices[idx + 2] = tr;
          frontTriCount++;
        }

        if (this.shouldEmitTriangle(tr, bl, br, dTR, dBL, dBR, mask, DEPTH_THRESHOLD)) {
          const idx = frontTriCount * 3;
          frontIndices[idx] = tr;
          frontIndices[idx + 1] = bl;
          frontIndices[idx + 2] = br;
          frontTriCount++;
        }
      }
    }

    // ── Find boundary edges (edges belonging to exactly 1 triangle) ──
    const edgeCounts = new Map<number, number>();
    const edgeKey = (a: number, b: number) => Math.min(a, b) * numVertices + Math.max(a, b);

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
        const b = k % numVertices;
        const a = (k - b) / numVertices;
        boundaryEdges.push([a, b]);
      }
    }

    // ── Build combined mesh: front + back + side skirt ──
    // Side skirt uses duplicated vertices (4 per edge quad) for hard normals
    const skirtVertexCount = boundaryEdges.length * 4;
    const totalVertices = numVertices * 2 + skirtVertexCount;
    const backTriCount = frontTriCount;
    const skirtTriCount = boundaryEdges.length * 2;
    const totalTriCount = frontTriCount + backTriCount + skirtTriCount;

    const positions = new Float32Array(totalVertices * 3);
    const uvs = new Float32Array(totalVertices * 2);
    const indices = new Uint32Array(totalTriCount * 3);

    // Copy front vertices
    positions.set(frontPositions);
    uvs.set(frontUvs);

    // Back vertices: offset Z by -shellThickness
    const backOffset = numVertices;
    for (let i = 0; i < numVertices; i++) {
      const i3 = i * 3;
      const bi3 = (i + backOffset) * 3;
      const bi2 = (i + backOffset) * 2;
      positions[bi3] = frontPositions[i3];
      positions[bi3 + 1] = frontPositions[i3 + 1];
      positions[bi3 + 2] = frontPositions[i3 + 2] - shellThickness;
      uvs[bi2] = frontUvs[i * 2];
      uvs[bi2 + 1] = frontUvs[i * 2 + 1];
    }

    // Copy front indices
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
      indices[dst + 1] = frontIndices[src + 2] + backOffset; // swapped
      indices[dst + 2] = frontIndices[src + 1] + backOffset; // swapped
    }
    idxOffset += backTriCount * 3;

    // Side skirt: 4 duplicated vertices + 2 triangles per boundary edge
    const skirtBaseVertex = numVertices * 2;
    for (let e = 0; e < boundaryEdges.length; e++) {
      const [a, b] = boundaryEdges[e];
      const sv = skirtBaseVertex + e * 4;

      // 4 corners of the side quad: frontA, frontB, backA, backB
      for (let c = 0; c < 4; c++) {
        const srcIdx = c < 2 ? (c === 0 ? a : b) : (c === 2 ? a : b);
        const isBack = c >= 2;
        const srcBase = srcIdx * 3;
        const dstV = sv + c;
        positions[dstV * 3] = frontPositions[srcBase];
        positions[dstV * 3 + 1] = frontPositions[srcBase + 1];
        positions[dstV * 3 + 2] = frontPositions[srcBase + 2] - (isBack ? shellThickness : 0);
        uvs[dstV * 2] = frontUvs[srcIdx * 2];
        uvs[dstV * 2 + 1] = frontUvs[srcIdx * 2 + 1];
      }

      // Two triangles: (fA, fB, bA) and (bA, fB, bB)
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
      indices,
      uvs,
      vertexCount: totalVertices,
      triangleCount: totalTriCount,
    };
  }

  private shouldEmitTriangle(
    i0: number, i1: number, i2: number,
    d0: number, d1: number, d2: number,
    mask: Uint8Array | null,
    depthThreshold: number
  ): boolean {
    // Skip if any vertex is background
    if (mask) {
      if (mask[i0] < 128 || mask[i1] < 128 || mask[i2] < 128) return false;
    }

    // Skip if depth difference across any edge exceeds threshold
    if (Math.abs(d0 - d1) > depthThreshold) return false;
    if (Math.abs(d1 - d2) > depthThreshold) return false;
    if (Math.abs(d0 - d2) > depthThreshold) return false;

    return true;
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = url;
    });
  }
}

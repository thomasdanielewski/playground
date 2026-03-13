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
   * Build a triangle mesh from depth data with optional foreground mask.
   * Skips background triangles and depth-discontinuity triangles.
   */
  buildMeshData(
    depthData: Uint8Array,
    width: number,
    height: number,
    mask: Uint8Array | null,
    depthScale = 0.3
  ): MeshData {
    const numVertices = width * height;
    const requiredBytes = numVertices * (3 + 2) * 4; // positions + uvs
    if (requiredBytes > 2_000_000_000) {
      throw new RangeError(`Mesh requires ~${(requiredBytes / 1e9).toFixed(1)} GB — reduce image resolution.`);
    }

    const positions = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);
    const scale = 2.0 / Math.max(width, height);

    // Generate vertices and UVs
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const i3 = i * 3;
        const i2 = i * 2;

        positions[i3] = (x - width / 2) * scale;
        positions[i3 + 1] = -(y - height / 2) * scale;
        positions[i3 + 2] = (depthData[i] / 255.0) * depthScale;

        uvs[i2] = x / (width - 1);
        uvs[i2 + 1] = y / (height - 1);
      }
    }

    // Generate triangle indices, skipping background and depth discontinuities
    const DEPTH_THRESHOLD = 25; // ~10% of 255 range
    const maxTriangles = (width - 1) * (height - 1) * 2;
    const indices = new Uint32Array(maxTriangles * 3);
    let triCount = 0;

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

        // Triangle 1: tl, bl, tr
        if (this.shouldEmitTriangle(tl, bl, tr, dTL, dBL, dTR, mask, DEPTH_THRESHOLD)) {
          const idx = triCount * 3;
          indices[idx] = tl;
          indices[idx + 1] = bl;
          indices[idx + 2] = tr;
          triCount++;
        }

        // Triangle 2: tr, bl, br
        if (this.shouldEmitTriangle(tr, bl, br, dTR, dBL, dBR, mask, DEPTH_THRESHOLD)) {
          const idx = triCount * 3;
          indices[idx] = tr;
          indices[idx + 1] = bl;
          indices[idx + 2] = br;
          triCount++;
        }
      }
    }

    return {
      positions,
      indices: indices.slice(0, triCount * 3),
      uvs,
      vertexCount: numVertices,
      triangleCount: triCount,
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

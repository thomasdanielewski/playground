export type { MeshData } from './meshBuilder';
export { buildMeshData } from './meshBuilder';

export interface ProcessedImage {
  url: string;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  wasDownscaled: boolean;
  scaleFactor: number;
}

const DEFAULT_MAX_PIXELS = 1_000_000;

export class ImageProcessor {
  private maxPixels: number;

  constructor(maxPixels: number = DEFAULT_MAX_PIXELS) {
    this.maxPixels = maxPixels;
  }

  getMaxPixels(): number { return this.maxPixels; }
  setMaxPixels(v: number): void { this.maxPixels = v; }

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

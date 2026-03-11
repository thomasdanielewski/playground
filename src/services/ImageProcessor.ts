export interface ProcessedImage {
  url: string;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  wasDownscaled: boolean;
  scaleFactor: number;
}

export interface PointCloudData {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
  pointSize: number;
}

const DEFAULT_MAX_POINTS = 1_000_000;

export class ImageProcessor {
  private maxPoints: number;

  constructor(maxPoints: number = DEFAULT_MAX_POINTS) {
    this.maxPoints = maxPoints;
  }

  async processImage(file: File): Promise<ProcessedImage> {
    const url = URL.createObjectURL(file);
    try {
      const img = await this.loadImage(url);
      const origW = img.naturalWidth;
      const origH = img.naturalHeight;
      const total = origW * origH;

      if (total <= this.maxPoints) {
        return { url, originalWidth: origW, originalHeight: origH, processedWidth: origW, processedHeight: origH, wasDownscaled: false, scaleFactor: 1 };
      }

      const scaleFactor = Math.sqrt(this.maxPoints / total);
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

  buildPointCloud(depthData: Uint8Array, colorData: Uint8ClampedArray, width: number, height: number, depthScale = 0.15): PointCloudData {
    const numPoints = width * height;
    const requiredBytes = numPoints * 3 * 4 * 2;
    if (requiredBytes > 2_000_000_000) {
      throw new RangeError(`Point cloud requires ~${(requiredBytes / 1e9).toFixed(1)} GB — reduce image resolution.`);
    }

    const positions = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);
    const scale = 2.0 / Math.max(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const i3 = i * 3;
        const i4 = i * 4;
        positions[i3] = (x - width / 2) * scale;
        positions[i3 + 1] = -(y - height / 2) * scale;
        positions[i3 + 2] = (depthData[i] / 255.0) * depthScale;
        colors[i3] = colorData[i4] / 255.0;
        colors[i3 + 1] = colorData[i4 + 1] / 255.0;
        colors[i3 + 2] = colorData[i4 + 2] / 255.0;
      }
    }

    const pointSize = Math.max(0.005, (2.0 / Math.max(width, height)) * 1.0);
    return { positions, colors, pointCount: numPoints, pointSize };
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

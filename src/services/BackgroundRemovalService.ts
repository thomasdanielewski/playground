import { pipeline, env } from '@huggingface/transformers';
import type { ModelDownloadProgress } from './DepthEstimationService';

env.allowLocalModels = false;

const BG_MODEL_ID = 'briaai/RMBG-1.4';

export interface BackgroundRemovalResult {
  /** Per-pixel mask: 0 = background, 255 = foreground */
  mask: Uint8Array;
  width: number;
  height: number;
  inferenceTimeMs: number;
}

/**
 * Client-side background removal using RMBG-1.4 via Transformers.js.
 * Produces a foreground mask for isolating the subject from the background.
 */
export class BackgroundRemovalService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private segmenter: any = null;
  private isModelLoaded = false;
  private loadPromise: Promise<void> | null = null;

  async loadModel(
    onProgress?: (info: ModelDownloadProgress) => void
  ): Promise<void> {
    if (this.isModelLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        this.segmenter = await (pipeline as any)(
          'image-segmentation',
          BG_MODEL_ID,
          {
            progress_callback: (info: Record<string, unknown>) => {
              if (!onProgress) return;
              const status = info.status as string;
              if (status === 'progress') {
                onProgress({
                  status: 'downloading',
                  file: info.file as string | undefined,
                  progress: Math.round(info.progress as number),
                  loadedBytes: info.loaded as number | undefined,
                  totalBytes: info.total as number | undefined,
                });
              } else if (status === 'ready') {
                onProgress({ status: 'ready', progress: 100 });
              } else if (status === 'initiate') {
                onProgress({
                  status: 'initiate',
                  file: info.file as string | undefined,
                  progress: 0,
                });
              }
            },
          }
        );
        this.isModelLoaded = true;
      } catch (error) {
        this.loadPromise = null;
        throw error;
      }
    })();

    return this.loadPromise;
  }

  async segment(imageUrl: string): Promise<BackgroundRemovalResult> {
    if (!this.segmenter) {
      throw new Error('Model not loaded. Call loadModel() before segment().');
    }

    const t0 = performance.now();
    const results = await this.segmenter(imageUrl);
    const inferenceTimeMs = performance.now() - t0;

    // RMBG-1.4 returns an array with a single result containing a mask RawImage
    const result = Array.isArray(results) ? results[0] : results;
    const maskImage = result.mask;

    // Convert RGBA mask data to single-channel Uint8Array
    const rgba = maskImage.data as Uint8Array;
    const w = maskImage.width as number;
    const h = maskImage.height as number;
    const mask = new Uint8Array(w * h);

    // The mask is grayscale stored in RGBA — use the R channel
    if (rgba.length === w * h) {
      // Already single channel
      mask.set(rgba);
    } else {
      // RGBA format — extract first channel
      for (let i = 0; i < w * h; i++) {
        mask[i] = rgba[i * 4];
      }
    }

    return { mask, width: w, height: h, inferenceTimeMs };
  }

  get ready(): boolean {
    return this.isModelLoaded;
  }

  dispose(): void {
    this.segmenter = null;
    this.isModelLoaded = false;
    this.loadPromise = null;
  }
}

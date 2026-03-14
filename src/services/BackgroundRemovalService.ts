import { pipeline, env } from '@huggingface/transformers';
import type { ModelDownloadProgress } from './DepthEstimationService';

env.allowLocalModels = false;

const BG_MODEL_ID = 'briaai/RMBG-1.4';

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export interface BackgroundRemovalResult {
  mask: Uint8Array;
  width: number;
  height: number;
  inferenceTimeMs: number;
}

export class BackgroundRemovalService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private segmenter: any = null;
  private isModelLoaded = false;
  private loadPromise: Promise<void> | null = null;

  async loadModel(
    onProgress?: (info: ModelDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isModelLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    checkAborted(signal);

    this.loadPromise = (async () => {
      try {
        this.segmenter = await (pipeline as any)(
          'image-segmentation',
          BG_MODEL_ID,
          {
            progress_callback: (info: Record<string, unknown>) => {
              checkAborted(signal);
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

  async segment(imageUrl: string, signal?: AbortSignal): Promise<BackgroundRemovalResult> {
    if (!this.segmenter) {
      throw new Error('Model not loaded. Call loadModel() before segment().');
    }

    checkAborted(signal);

    const t0 = performance.now();
    const results = await this.segmenter(imageUrl);
    const inferenceTimeMs = performance.now() - t0;

    checkAborted(signal);

    const result = Array.isArray(results) ? results[0] : results;
    const maskImage = result.mask;

    const rgba = maskImage.data as Uint8Array;
    const w = maskImage.width as number;
    const h = maskImage.height as number;
    const mask = new Uint8Array(w * h);

    if (rgba.length === w * h) {
      mask.set(rgba);
    } else {
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

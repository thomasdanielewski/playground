import { pipeline, env } from '@huggingface/transformers';
import type { RawImage } from '@huggingface/transformers';

// Force remote model loading from Hugging Face Hub
env.allowLocalModels = false;

/**
 * Progress event emitted during model download.
 */
export interface ModelDownloadProgress {
  status: 'initiate' | 'downloading' | 'ready';
  file?: string;
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
}

/**
 * Result of a depth estimation inference pass.
 */
export interface DepthEstimationResult {
  depthData: Uint8Array;
  width: number;
  height: number;
  inferenceTimeMs: number;
}

const MODEL_ID = 'Xenova/depth-anything-small-hf';

/**
 * Encapsulates the Transformers.js depth-estimation pipeline.
 *
 * Usage:
 *   const service = new DepthEstimationService();
 *   await service.loadModel(onProgress);
 *   const result = await service.estimateDepth(imageUrl);
 *   service.dispose();
 */
export class DepthEstimationService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private estimator: any = null;
  private isModelLoaded = false;
  private loadPromise: Promise<void> | null = null;

  /**
   * Downloads and initializes the depth-estimation model.
   * Safe to call multiple times — subsequent calls share the same promise.
   */
  async loadModel(
    onProgress?: (info: ModelDownloadProgress) => void
  ): Promise<void> {
    if (this.isModelLoaded) return;

    // Prevent concurrent loads
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        this.estimator = await (pipeline as any)(
          'depth-estimation',
          MODEL_ID,
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

  /**
   * Runs depth estimation on the given image URL.
   * Model must be loaded first via `loadModel()`.
   */
  async estimateDepth(imageUrl: string): Promise<DepthEstimationResult> {
    if (!this.estimator) {
      throw new Error(
        'Model not loaded. Call loadModel() before estimateDepth().'
      );
    }

    const t0 = performance.now();
    const result = await this.estimator(imageUrl);
    const inferenceTimeMs = performance.now() - t0;

    const output = Array.isArray(result) ? result[0] : result;
    const depthImage = (output as Record<string, unknown>).depth as RawImage;

    return {
      depthData: depthImage.data as unknown as Uint8Array,
      width: depthImage.width,
      height: depthImage.height,
      inferenceTimeMs,
    };
  }

  /** Returns true if the model has been loaded and is ready. */
  get ready(): boolean {
    return this.isModelLoaded;
  }

  /** Releases all model resources. */
  dispose(): void {
    this.estimator = null;
    this.isModelLoaded = false;
    this.loadPromise = null;
  }
}

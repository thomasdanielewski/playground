import { pipeline, env } from '@huggingface/transformers';
import type { RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;

export interface ModelDownloadProgress {
  status: 'initiate' | 'downloading' | 'ready';
  file?: string;
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
}

export interface DepthEstimationResult {
  depthData: Uint8Array;
  width: number;
  height: number;
  inferenceTimeMs: number;
}

const MODEL_ID = 'onnx-community/depth-anything-v2-base';

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export class DepthEstimationService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private estimator: any = null;
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
        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
        this.estimator = await (pipeline as any)(
          'depth-estimation',
          MODEL_ID,
          {
            device: hasWebGPU ? 'webgpu' : 'wasm',
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

  async estimateDepth(imageUrl: string, signal?: AbortSignal): Promise<DepthEstimationResult> {
    if (!this.estimator) {
      throw new Error('Model not loaded. Call loadModel() before estimateDepth().');
    }

    checkAborted(signal);

    const t0 = performance.now();
    const result = await this.estimator(imageUrl);
    const inferenceTimeMs = performance.now() - t0;

    checkAborted(signal);

    const output = Array.isArray(result) ? result[0] : result;
    const depthImage = (output as Record<string, unknown>).depth as RawImage;

    return {
      depthData: depthImage.data as unknown as Uint8Array,
      width: depthImage.width,
      height: depthImage.height,
      inferenceTimeMs,
    };
  }

  get ready(): boolean {
    return this.isModelLoaded;
  }

  dispose(): void {
    this.estimator = null;
    this.isModelLoaded = false;
    this.loadPromise = null;
  }
}

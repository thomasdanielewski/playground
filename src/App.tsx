import { useCallback, useEffect, useRef, useState } from 'react';
import { DepthEstimationService } from './services/DepthEstimationService';
import type { ModelDownloadProgress } from './services/DepthEstimationService';
import { BackgroundRemovalService } from './services/BackgroundRemovalService';
import { ImageProcessor } from './services/ImageProcessor';
import { MeshRenderer } from './services/MeshRenderer';
import type { RendererType } from './services/MeshRenderer';
import { bilateralFilter } from './services/BilateralFilter';
import UploadPanel from './components/UploadPanel';
import ProgressTracker from './components/ProgressTracker';
import type { Phase } from './components/ProgressTracker';
import StatusBadge from './components/StatusBadge';

// ── Error classification ──────────────────────────────────
function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof RangeError || /memory|allocation|oom/i.test(msg)) {
    return 'Out of memory — try a smaller image or close other tabs.';
  }
  if (/network|fetch|load/i.test(msg)) {
    return 'Network error — check your connection and try again.';
  }
  if (/context|webgl|gpu/i.test(msg)) {
    return 'Graphics context failed — your browser may not support WebGL.';
  }
  return msg || 'An unexpected error occurred.';
}

// ── Browser compatibility check ───────────────────────────
function checkBrowserSupport(): string | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'Your browser does not support WebGL. Please use Chrome, Edge, or Firefox.';
  if (typeof Worker === 'undefined') return 'Your browser does not support Web Workers.';
  return null;
}

// ── Main application ──────────────────────────────────────
export default function App() {
  // Services (stable across renders)
  const depthServiceRef = useRef(new DepthEstimationService());
  const bgServiceRef = useRef(new BackgroundRemovalService());
  const imageProcessorRef = useRef(new ImageProcessor());
  const rendererRef = useRef<MeshRenderer | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  // UI state
  const [phase, setPhase] = useState<Phase>('idle');
  const [depthDownloadProgress, setDepthDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [bgDownloadProgress, setBgDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [inferenceTimeMs, setInferenceTimeMs] = useState<number | undefined>();
  const [triangleCount, setTriangleCount] = useState<number | undefined>();
  const [wasDownscaled, setWasDownscaled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [rendererType, setRendererType] = useState<RendererType | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);

  // ── Initialise Three.js renderer ────────────────────────
  useEffect(() => {
    const unsupported = checkBrowserSupport();
    if (unsupported) {
      setBrowserError(unsupported);
      return;
    }

    if (!mountRef.current) return;

    let disposed = false;

    (async () => {
      try {
        const renderer = await MeshRenderer.create(mountRef.current!);
        if (disposed) { renderer.dispose(); return; }
        rendererRef.current = renderer;
        setRendererType(renderer.getRendererType());
      } catch (e) {
        console.error('[App] Renderer init failed:', e);
        setBrowserError('Could not initialise 3D renderer. Please try a different browser.');
      }
    })();

    const handleResize = () => rendererRef.current?.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      depthServiceRef.current.dispose();
      bgServiceRef.current.dispose();
    };
  }, []);

  // ── Pipeline: file → depth + bg removal → mesh ──────────
  const handleFile = useCallback(async (file: File) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Reset state
    setPhase('downloading');
    setDepthDownloadProgress(null);
    setBgDownloadProgress(null);
    setInferenceTimeMs(undefined);
    setTriangleCount(undefined);
    setWasDownscaled(false);
    setErrorMessage(undefined);

    try {
      // 1. Process image (downscale if needed)
      const imgProc = imageProcessorRef.current;
      const processed = await imgProc.processImage(file);
      setWasDownscaled(processed.wasDownscaled);

      // 2. Load both models in parallel (cached after first download)
      const depthService = depthServiceRef.current;
      const bgService = bgServiceRef.current;

      await Promise.all([
        depthService.loadModel((info) => setDepthDownloadProgress(info)),
        bgService.loadModel((info) => setBgDownloadProgress(info)),
      ]);

      // 3. Run depth estimation + background segmentation in parallel
      setPhase('estimating');
      const [depthResult, bgResult] = await Promise.all([
        depthService.estimateDepth(processed.url),
        bgService.segment(processed.url),
      ]);
      setInferenceTimeMs(depthResult.inferenceTimeMs);

      // 4. Build mesh
      setPhase('building');

      // Bilateral filter on depth map for smoother surfaces
      const smoothedDepth = bilateralFilter(
        depthResult.depthData,
        depthResult.width,
        depthResult.height
      );

      // Resize mask to match depth dimensions if they differ
      const mask = imgProc.resizeMask(
        bgResult.mask,
        bgResult.width,
        bgResult.height,
        depthResult.width,
        depthResult.height
      );

      // Build triangle mesh
      const meshData = imgProc.buildMeshData(
        smoothedDepth,
        depthResult.width,
        depthResult.height,
        mask
      );
      setTriangleCount(meshData.triangleCount);

      // 5. Render with texture
      await renderer.setMesh(meshData, processed.url);
      renderer.resetCamera();
      setPhase('done');
    } catch (err) {
      console.error('[App] Pipeline error:', err);
      setErrorMessage(classifyError(err));
      setPhase('error');
    }
  }, []);

  // ── Browser compatibility overlay ───────────────────────
  if (browserError) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-8 z-50">
        <div className="glass-panel rounded-2xl p-8 max-w-md text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-400/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-lg font-medium text-zinc-100 mb-2">Browser Not Supported</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">{browserError}</p>
        </div>
      </div>
    );
  }

  const isProcessing = phase === 'downloading' || phase === 'estimating' || phase === 'building';

  return (
    <div className="relative w-full h-screen bg-[#08080a] text-zinc-100 overflow-hidden">
      {/* ── 3D Viewport ──────────────────────────── */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" id="viewport" />

      {/* ── Control Panel ────────────────────────── */}
      <div className="absolute top-0 left-0 w-full p-5 z-10 pointer-events-none flex flex-col items-center">
        <div className="pointer-events-auto glass-panel rounded-2xl p-5 max-w-[340px] w-full flex flex-col gap-4 animate-fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">
                2D → 3D Mesh
              </h1>
              <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-widest">
                AI Depth + Background Removal
              </p>
            </div>
            <StatusBadge rendererType={rendererType} />
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.04]" />

          {/* Upload */}
          {phase !== 'done' ? (
            <UploadPanel
              onFileSelected={handleFile}
              disabled={isProcessing}
            />
          ) : (
            <label className="w-full py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.1] transition-colors text-[13px] font-medium text-zinc-300 hover:text-white flex items-center justify-center gap-2 cursor-pointer group">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
                strokeWidth="1.5"
                className="text-zinc-400 group-hover:text-emerald-400 transition-colors"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Upload New Image
              <input
                type="file"
                accept="image/jpeg, image/png, image/webp, image/bmp, image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>
          )}

          {/* Progress / status */}
          <ProgressTracker
            phase={phase}
            depthDownloadProgress={depthDownloadProgress}
            bgDownloadProgress={bgDownloadProgress}
            inferenceTimeMs={inferenceTimeMs}
            triangleCount={triangleCount}
            wasDownscaled={wasDownscaled}
            errorMessage={errorMessage}
          />

          {/* Footer */}
          <div className="h-px bg-white/[0.04]" />
          <p className="text-[9px] text-zinc-600 text-center leading-tight tracking-wide uppercase">
            All processing runs locally on your device
          </p>
        </div>
      </div>
    </div>
  );
}

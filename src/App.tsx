import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DepthEstimationService } from './services/DepthEstimationService';
import type { ModelDownloadProgress } from './services/DepthEstimationService';
import { BackgroundRemovalService } from './services/BackgroundRemovalService';
import { ImageProcessor } from './services/ImageProcessor';
import { MeshRenderer } from './services/MeshRenderer';
import type { RendererType, MaterialMode, ExportFormat } from './services/MeshRenderer';
import type { MeshData } from './services/meshBuilder';
import MeshWorkerFactory from './workers/meshBuilder.worker?worker';

interface MeshWorkerInput {
  depthData: Uint8Array;
  width: number;
  height: number;
  mask: Uint8Array | null;
  kernelRadius: number;
  spatialSigma: number;
  rangeSigma: number;
  depthScale: number;
  shellThickness: number;
}
import UploadPanel from './components/UploadPanel';
import type { UploadPanelHandle } from './components/UploadPanel';
import ProgressTracker from './components/ProgressTracker';
import type { Phase } from './components/ProgressTracker';
import StatusBadge from './components/StatusBadge';
import ComparisonView from './components/ComparisonView';

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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function checkBrowserSupport(): string | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'Your browser does not support WebGL. Please use Chrome, Edge, or Firefox.';
  if (typeof Worker === 'undefined') return 'Your browser does not support Web Workers.';
  return null;
}

/** Render a Uint8Array depth map to a data URL for comparison view */
function depthToImageUrl(data: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** Render a mask as colored overlay for comparison view */
function maskToImageUrl(mask: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    const fg = mask[i] >= 128;
    img.data[i * 4] = fg ? 255 : 80;
    img.data[i * 4 + 1] = fg ? 255 : 30;
    img.data[i * 4 + 2] = fg ? 255 : 30;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// ── Main application ──────────────────────────────────────
export default function App() {
  // Services (lazy init)
  const depthServiceRef = useRef<DepthEstimationService | null>(null);
  const bgServiceRef = useRef<BackgroundRemovalService | null>(null);
  const imageProcessorRef = useRef<ImageProcessor | null>(null);
  const rendererRef = useRef<MeshRenderer | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<UploadPanelHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const processedUrlRef = useRef<string | null>(null);

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
  const [materialMode, setMaterialMode] = useState<MaterialMode>('clay');
  const [isExporting, setIsExporting] = useState(false);

  // New state
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState('mesh');
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [depthScale, setDepthScale] = useState(1.5);
  const [smoothing, setSmoothing] = useState(5);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('glb');
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonTab, setComparisonTab] = useState<'3d' | 'source' | 'depth' | 'mask'>('3d');
  const [depthMapUrl, setDepthMapUrl] = useState<string | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);

  // Batch queue
  const [fileQueue, setFileQueue] = useState<{ file: File; status: 'pending' | 'processing' | 'done' | 'error' }[]>([]);
  const queueProcessingRef = useRef(false);

  // Store last inference results for slider rebuild
  const lastInferenceRef = useRef<{
    depthData: Uint8Array;
    width: number;
    height: number;
    mask: Uint8Array;
    imageUrl: string;
  } | null>(null);

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
      depthServiceRef.current?.dispose();
      bgServiceRef.current?.dispose();
      if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current);
    };
  }, []);

  // ── Keyboard shortcut: Ctrl+O ───────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        uploadRef.current?.openPicker();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Cancel handler ──────────────────────────────────────
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
  }, []);

  // ── Build mesh via Worker ───────────────────────────────
  const buildMeshViaWorker = useCallback((
    depthData: Uint8Array,
    width: number,
    height: number,
    mask: Uint8Array | null,
    dScale: number,
    smooth: number,
    signal: AbortSignal
  ): Promise<MeshData> => {
    return new Promise((resolve, reject) => {
      const worker = new MeshWorkerFactory();
      const onAbort = () => { worker.terminate(); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', onAbort, { once: true });

      worker.onmessage = (e: MessageEvent<MeshData>) => {
        signal.removeEventListener('abort', onAbort);
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => {
        signal.removeEventListener('abort', onAbort);
        worker.terminate();
        reject(new Error(e.message || 'Worker error'));
      };

      const input: MeshWorkerInput = {
        depthData,
        width,
        height,
        mask,
        kernelRadius: smooth,
        spatialSigma: 4.0,
        rangeSigma: 20,
        depthScale: dScale,
        shellThickness: 0.15,
      };

      const transfers: ArrayBuffer[] = [depthData.buffer];
      if (mask) transfers.push(mask.buffer);
      worker.postMessage(input, transfers);
    });
  }, []);

  // ── Pipeline: file → depth + bg removal → mesh ──────────
  const handleFile = useCallback(async (file: File, retryCount = 0) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Abort any in-progress pipeline
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    // Lazy service init
    if (!depthServiceRef.current) depthServiceRef.current = new DepthEstimationService();
    if (!bgServiceRef.current) bgServiceRef.current = new BackgroundRemovalService();
    if (!imageProcessorRef.current) imageProcessorRef.current = new ImageProcessor();

    // Cleanup previous URL
    if (processedUrlRef.current) {
      URL.revokeObjectURL(processedUrlRef.current);
      processedUrlRef.current = null;
    }

    // Reset state
    setPhase('downloading');
    setDepthDownloadProgress(null);
    setBgDownloadProgress(null);
    setInferenceTimeMs(undefined);
    setTriangleCount(undefined);
    setWasDownscaled(false);
    setErrorMessage(undefined);
    setLastFile(file);
    setCurrentFileName(file.name.replace(/\.[^.]+$/, ''));
    setShowComparison(false);
    setComparisonTab('3d');

    // Set thumbnail
    const thumbUrl = URL.createObjectURL(file);
    setThumbnailUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return thumbUrl; });

    try {
      // 1. Process image
      const imgProc = imageProcessorRef.current;
      if (retryCount > 0) {
        imgProc.setMaxPixels(Math.max(250_000, imgProc.getMaxPixels() / 2));
      }
      const processed = await imgProc.processImage(file);
      processedUrlRef.current = processed.url;
      setWasDownscaled(processed.wasDownscaled);
      if (signal.aborted) return;

      // 2. Load models in parallel
      const depthService = depthServiceRef.current;
      const bgService = bgServiceRef.current;

      await Promise.all([
        depthService.loadModel((info) => setDepthDownloadProgress(info), signal),
        bgService.loadModel((info) => setBgDownloadProgress(info), signal),
      ]);
      if (signal.aborted) return;

      // 3. Run inference in parallel
      setPhase('estimating');
      const [depthResult, bgResult] = await Promise.all([
        depthService.estimateDepth(processed.url, signal),
        bgService.segment(processed.url, signal),
      ]);
      setInferenceTimeMs(depthResult.inferenceTimeMs);
      if (signal.aborted) return;

      // Store for comparison view
      setDepthMapUrl(depthToImageUrl(depthResult.depthData, depthResult.width, depthResult.height));

      // Resize mask
      const mask = imgProc.resizeMask(
        bgResult.mask,
        bgResult.width,
        bgResult.height,
        depthResult.width,
        depthResult.height
      );
      setMaskUrl(maskToImageUrl(mask, depthResult.width, depthResult.height));

      // Save for slider rebuilds
      lastInferenceRef.current = {
        depthData: new Uint8Array(depthResult.depthData),
        width: depthResult.width,
        height: depthResult.height,
        mask: new Uint8Array(mask),
        imageUrl: processed.url,
      };

      // 4. Build mesh in worker
      setPhase('building');
      const meshData = await buildMeshViaWorker(
        depthResult.depthData,
        depthResult.width,
        depthResult.height,
        mask,
        depthScale,
        smoothing,
        signal
      );
      if (signal.aborted) return;
      setTriangleCount(meshData.triangleCount);

      // 5. Render
      await renderer.setMesh(meshData, processed.url);
      renderer.resetCamera();
      setPhase('done');
      setShowComparison(true);
    } catch (err) {
      if (isAbortError(err)) {
        setPhase('idle');
        return;
      }

      // Auto-retry once for OOM with smaller resolution
      if (retryCount === 0 && (err instanceof RangeError || /memory|allocation|oom/i.test(String(err)))) {
        console.warn('[App] OOM — retrying with lower resolution');
        handleFile(file, 1);
        return;
      }

      console.error('[App] Pipeline error:', err);
      setErrorMessage(classifyError(err));
      setPhase('error');
    }
  }, [depthScale, smoothing, buildMeshViaWorker]);

  // ── Rebuild mesh from sliders (skip inference) ──────────
  const rebuildMesh = useCallback(async (dScale: number, smooth: number) => {
    const renderer = rendererRef.current;
    const saved = lastInferenceRef.current;
    if (!renderer || !saved) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('building');
    try {
      const meshData = await buildMeshViaWorker(
        new Uint8Array(saved.depthData),
        saved.width,
        saved.height,
        new Uint8Array(saved.mask),
        dScale,
        smooth,
        controller.signal
      );
      if (controller.signal.aborted) return;

      setTriangleCount(meshData.triangleCount);
      await renderer.setMesh(meshData, saved.imageUrl);
      renderer.resetCamera();
      setPhase('done');
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('[App] Rebuild error:', err);
        setErrorMessage(classifyError(err));
        setPhase('error');
      }
    }
  }, [buildMeshViaWorker]);

  // ── Batch: handle multiple files ────────────────────────
  const handleFiles = useCallback((files: File[]) => {
    if (files.length === 1) {
      handleFile(files[0]);
      return;
    }
    setFileQueue(files.map((f) => ({ file: f, status: 'pending' as const })));
  }, [handleFile]);

  // Process batch queue
  useEffect(() => {
    if (queueProcessingRef.current) return;
    const nextIdx = fileQueue.findIndex((f) => f.status === 'pending');
    if (nextIdx === -1) return;

    queueProcessingRef.current = true;
    setFileQueue((q) => q.map((f, i) => i === nextIdx ? { ...f, status: 'processing' as const } : f));

    const file = fileQueue[nextIdx].file;
    handleFile(file).then(() => {
      setFileQueue((q) => q.map((f, i) => i === nextIdx ? { ...f, status: 'done' as const } : f));
      queueProcessingRef.current = false;
    }).catch(() => {
      setFileQueue((q) => q.map((f, i) => i === nextIdx ? { ...f, status: 'error' as const } : f));
      queueProcessingRef.current = false;
    });
  }, [fileQueue, handleFile]);

  // ── Export handler ──────────────────────────────────────
  const handleExport = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || isExporting) return;
    setIsExporting(true);
    try {
      let blob: Blob;
      let ext: string;
      if (exportFormat === 'obj') {
        const objStr = renderer.exportOBJ();
        blob = new Blob([objStr], { type: 'text/plain' });
        ext = 'obj';
      } else if (exportFormat === 'stl') {
        const buf = renderer.exportSTL();
        blob = new Blob([buf], { type: 'application/octet-stream' });
        ext = 'stl';
      } else {
        blob = await renderer.exportGLB();
        ext = 'glb';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFileName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[App] Export failed:', e);
    } finally {
      setIsExporting(false);
    }
  }, [exportFormat, currentFileName, isExporting]);

  // ── Full-window drop handlers ───────────────────────────
  const onRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(true);
  }, []);
  const onRootDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setRootDragOver(false);
  }, []);
  const onRootDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const accepted = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];
    const files = Array.from(e.dataTransfer.files).filter((f: File) => accepted.includes(f.type));
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  // ── Browser compatibility overlay ───────────────────────
  if (browserError) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-8 z-50">
        <div className="glass-panel rounded-2xl p-8 max-w-md text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-red-400/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-lg font-medium text-zinc-100 mb-2">Browser Not Supported</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">{browserError}</p>
        </div>
      </div>
    );
  }

  const isProcessing = phase === 'downloading' || phase === 'estimating' || phase === 'building';
  const showViewport = comparisonTab === '3d';

  return (
    <div
      className="relative w-full h-screen bg-[#08080a] text-zinc-100 overflow-hidden"
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      {/* ── 3D Viewport ──────────────────────────── */}
      <div
        ref={mountRef}
        className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${showViewport ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        id="viewport"
      />

      {/* ── Loading skeleton ─────────────────────── */}
      {rendererType === null && !browserError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="skeleton-pulse w-32 h-32 rounded-2xl" />
        </div>
      )}

      {/* ── Full-window drop overlay ─────────────── */}
      {rootDragOver && (
        <div className="drop-overlay">
          <div className="text-center">
            <p className="text-lg font-medium text-emerald-400">Drop image to process</p>
            <p className="text-sm text-zinc-400 mt-1">JPG, PNG, WebP</p>
          </div>
        </div>
      )}

      {/* ── Control Panel ────────────────────────── */}
      <div className="control-panel absolute top-0 left-0 w-full p-5 z-10 pointer-events-none flex flex-col items-center">
        <div className={`control-panel-inner pointer-events-auto glass-panel rounded-2xl p-5 max-w-[340px] w-full flex flex-col gap-3 animate-fade-in ${mobileCollapsed ? 'max-h-[48px] overflow-hidden' : ''}`}>

          {/* Mobile drag handle */}
          <div
            className="mobile-handle hidden w-10 h-1 rounded-full bg-white/10 mx-auto mb-1 cursor-pointer"
            onClick={() => setMobileCollapsed((c) => !c)}
          />

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {thumbnailUrl && (phase === 'done' || isProcessing) && (
                <img
                  src={thumbnailUrl}
                  alt="Input"
                  className="w-8 h-8 rounded-lg object-cover border border-white/[0.06]"
                />
              )}
              <div>
                <h1 className="text-[15px] font-semibold tracking-tight">
                  2D → 3D Mesh
                </h1>
                <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-widest">
                  AI Depth + Background Removal
                </p>
              </div>
            </div>
            <StatusBadge rendererType={rendererType} />
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.06]" />

          {/* Upload — always visible */}
          <UploadPanel
            ref={uploadRef}
            onFilesSelected={handleFiles}
            disabled={isProcessing}
            compact={phase === 'done'}
            multiple
          />

          {/* Batch queue indicator */}
          {fileQueue.length > 1 && (
            <div className="flex flex-col gap-1">
              {fileQueue.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    item.status === 'done' ? 'bg-emerald-400' :
                    item.status === 'processing' ? 'bg-amber-400 animate-pulse' :
                    item.status === 'error' ? 'bg-red-400' :
                    'bg-zinc-600'
                  }`} />
                  <span className="text-zinc-400 truncate max-w-[200px]">{item.file.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Material toggle */}
          {phase === 'done' && (
            <div className="flex gap-1.5">
              {(['clay', 'textured', 'wireframe'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setMaterialMode(mode);
                    rendererRef.current?.setMaterialMode(mode);
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    materialMode === mode
                      ? 'bg-white/15 text-white'
                      : 'bg-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {mode === 'clay' ? 'Clay' : mode === 'textured' ? 'Textured' : 'Wire'}
                </button>
              ))}
            </div>
          )}

          {/* Comparison view */}
          {showComparison && phase === 'done' && (
            <ComparisonView
              sourceUrl={thumbnailUrl}
              depthMapUrl={depthMapUrl}
              maskUrl={maskUrl}
              onSelectTab={(tab) => setComparisonTab(tab)}
            />
          )}

          {/* Depth / Smoothing sliders */}
          {phase === 'done' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Depth</label>
                <span className="text-[10px] font-mono text-zinc-400">{depthScale.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="4.0"
                step="0.1"
                value={depthScale}
                onChange={(e) => setDepthScale(parseFloat(e.target.value))}
                onMouseUp={() => rebuildMesh(depthScale, smoothing)}
                onTouchEnd={() => rebuildMesh(depthScale, smoothing)}
                className="w-full"
              />
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Smoothing</label>
                <span className="text-[10px] font-mono text-zinc-400">{smoothing}</span>
              </div>
              <input
                type="range"
                min="1"
                max="9"
                step="1"
                value={smoothing}
                onChange={(e) => setSmoothing(parseInt(e.target.value))}
                onMouseUp={() => rebuildMesh(depthScale, smoothing)}
                onTouchEnd={() => rebuildMesh(depthScale, smoothing)}
                className="w-full"
              />
            </div>
          )}

          {/* Export */}
          {phase === 'done' && (
            <div className="flex gap-1.5">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="bg-white/[0.06] border border-white/[0.06] rounded-lg text-[11px] text-zinc-300 px-2 py-2 outline-none cursor-pointer"
              >
                <option value="glb">GLB</option>
                <option value="obj">OBJ</option>
                <option value="stl">STL</option>
              </select>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex-1 py-2 rounded-lg border border-white/[0.06] bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-[12px] font-medium text-zinc-300 hover:text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth="1.5"
                  className="text-zinc-400"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {isExporting ? 'Exporting...' : `Export ${exportFormat.toUpperCase()}`}
              </button>
            </div>
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
            onCancel={isProcessing ? handleCancel : undefined}
            onRetry={phase === 'error' && lastFile ? () => handleFile(lastFile) : undefined}
          />

          {/* Footer */}
          <div className="h-px bg-white/[0.06]" />
          <p className="text-[9px] text-zinc-600 text-center leading-tight tracking-wide uppercase">
            All processing runs locally on your device · <span className="text-zinc-700">Ctrl+O to upload</span>
          </p>
        </div>
      </div>
    </div>
  );
}

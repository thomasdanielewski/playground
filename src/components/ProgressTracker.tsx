import { useEffect, useRef, useState } from 'react';
import type { ModelDownloadProgress } from '../services/DepthEstimationService';

export type Phase =
  | 'idle'
  | 'downloading'
  | 'estimating'
  | 'building'
  | 'done'
  | 'error';

interface Props {
  phase: Phase;
  downloadProgress?: ModelDownloadProgress | null;
  inferenceTimeMs?: number;
  pointCount?: number;
  wasDownscaled?: boolean;
  errorMessage?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(performance.now());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(performance.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return <span className="font-mono text-zinc-300">{(elapsed / 1000).toFixed(1)}s</span>;
}

export default function ProgressTracker({
  phase,
  downloadProgress,
  inferenceTimeMs,
  pointCount,
  wasDownscaled,
  errorMessage,
}: Props) {
  if (phase === 'idle') return null;

  return (
    <div className="w-full flex flex-col gap-3 animate-fade-in" id="progress-tracker">
      {/* ── Download phase ──────────────────────── */}
      {phase === 'downloading' && downloadProgress && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-medium">
              Downloading Model
            </span>
            <span className="text-[11px] font-mono text-zinc-300">
              {downloadProgress.progress}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${downloadProgress.progress}%`,
                background: 'linear-gradient(90deg, #10b981, #34d399)',
              }}
            />
          </div>

          {/* Byte breakdown */}
          {downloadProgress.loadedBytes != null && downloadProgress.totalBytes != null && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 truncate max-w-[160px]">
                {downloadProgress.file?.split('/').pop() ?? 'model'}
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                {formatBytes(downloadProgress.loadedBytes)} / {formatBytes(downloadProgress.totalBytes)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Inference phase ─────────────────────── */}
      {phase === 'estimating' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-medium">
              Estimating Depth
            </span>
          </div>
          <ElapsedTimer />
        </div>
      )}

      {/* ── Building phase ──────────────────────── */}
      {phase === 'building' && (
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-medium">
            Building Geometry
          </span>
        </div>
      )}

      {/* ── Done ────────────────────────────────── */}
      {phase === 'done' && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] text-emerald-400 uppercase tracking-widest font-medium">
              Complete
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {inferenceTimeMs != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-3 py-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Inference</p>
                <p className="text-[13px] font-mono text-zinc-200 mt-0.5">
                  {(inferenceTimeMs / 1000).toFixed(2)}s
                </p>
              </div>
            )}
            {pointCount != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-3 py-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Points</p>
                <p className="text-[13px] font-mono text-zinc-200 mt-0.5">
                  {pointCount.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {wasDownscaled && (
            <p className="text-[10px] text-amber-400/80 leading-tight">
              Image was downscaled to stay within the point budget.
            </p>
          )}

          <p className="text-[10px] text-zinc-500 leading-tight">
            Drag to rotate · scroll to zoom · right-click to pan
          </p>
        </div>
      )}

      {/* ── Error ───────────────────────────────── */}
      {phase === 'error' && (
        <div className="flex flex-col gap-1 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[11px] text-red-400 uppercase tracking-widest font-medium">
              Error
            </span>
          </div>
          <p className="text-[11px] text-red-300/80 leading-snug">
            {errorMessage || 'An unexpected error occurred.'}
          </p>
        </div>
      )}
    </div>
  );
}

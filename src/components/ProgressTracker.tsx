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
  depthDownloadProgress?: ModelDownloadProgress | null;
  bgDownloadProgress?: ModelDownloadProgress | null;
  inferenceTimeMs?: number;
  triangleCount?: number;
  wasDownscaled?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onCancel?: () => void;
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

function DownloadBar({ label, progress }: { label: string; progress: ModelDownloadProgress }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-medium">
          {label}
        </span>
        <span className="text-[11px] font-mono text-zinc-300">
          {progress.progress}%
        </span>
      </div>
      <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-spring"
          style={{
            width: `${progress.progress}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-light))',
          }}
        />
      </div>
      {progress.loadedBytes != null && progress.totalBytes != null && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 truncate max-w-[160px]">
            {progress.file?.split('/').pop() ?? 'model'}
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {formatBytes(progress.loadedBytes)} / {formatBytes(progress.totalBytes)}
          </span>
        </div>
      )}
    </div>
  );
}

const isProcessingPhase = (p: Phase) => p === 'downloading' || p === 'estimating' || p === 'building';

export default function ProgressTracker({
  phase,
  depthDownloadProgress,
  bgDownloadProgress,
  inferenceTimeMs,
  triangleCount,
  wasDownscaled,
  errorMessage,
  onRetry,
  onCancel,
}: Props) {
  if (phase === 'idle') return null;

  return (
    <div className="w-full flex flex-col gap-3 animate-fade-in" id="progress-tracker">
      {/* ── Download phase ──────────────────────── */}
      {phase === 'downloading' && (
        <div className="flex flex-col gap-3">
          {depthDownloadProgress && (
            <DownloadBar label="Depth Model" progress={depthDownloadProgress} />
          )}
          {bgDownloadProgress && (
            <DownloadBar label="Background Model" progress={bgDownloadProgress} />
          )}
          {!depthDownloadProgress && !bgDownloadProgress && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-medium">
                Preparing Models
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
              Analyzing Image
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
            Building 3D Mesh
          </span>
        </div>
      )}

      {/* ── Cancel button during processing ────── */}
      {isProcessingPhase(phase) && onCancel && (
        <button
          onClick={onCancel}
          className="w-full py-1.5 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-300 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-colors"
        >
          Cancel
        </button>
      )}

      {/* ── Done ────────────────────────────────── */}
      {phase === 'done' && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 12 12" className="text-emerald-400">
              <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.5 6L5.5 8L8.5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[11px] text-emerald-400 uppercase tracking-widest font-medium">
              Complete
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {inferenceTimeMs != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Inference</p>
                <p className="text-[13px] font-mono text-zinc-200 mt-0.5">
                  {(inferenceTimeMs / 1000).toFixed(2)}s
                </p>
              </div>
            )}
            {triangleCount != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Triangles</p>
                <p className="text-[13px] font-mono text-zinc-200 mt-0.5">
                  {triangleCount.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {wasDownscaled && (
            <p className="text-[10px] text-amber-400/80 leading-tight">
              Image was downscaled to fit processing limits.
            </p>
          )}
        </div>
      )}

      {/* ── Orbit hint (shown during building + done) ── */}
      {(phase === 'done' || phase === 'building') && (
        <p className="text-[10px] text-zinc-500 leading-tight">
          Drag to rotate · scroll to zoom · right-click to pan
        </p>
      )}

      {/* ── Error ───────────────────────────────── */}
      {phase === 'error' && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[11px] text-red-400 uppercase tracking-widest font-medium">
              Error
            </span>
          </div>
          <p className="text-[11px] text-red-300/80 leading-snug">
            {errorMessage || 'An unexpected error occurred.'}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full py-1.5 rounded-lg text-[11px] font-medium text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

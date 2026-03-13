import { Cpu, Zap } from 'lucide-react';
import type { RendererType } from '../services/MeshRenderer';

interface Props {
  rendererType: RendererType | null;
}

export default function StatusBadge({ rendererType }: Props) {
  if (!rendererType) return null;

  const isGPU = rendererType === 'webgpu';

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium
        uppercase tracking-widest transition-all duration-300
        ${isGPU
          ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20'
          : 'bg-white/[0.04] text-zinc-400 border border-white/[0.06]'
        }
      `}
      id="renderer-badge"
    >
      {isGPU ? <Zap size={10} /> : <Cpu size={10} />}
      {rendererType}
    </div>
  );
}

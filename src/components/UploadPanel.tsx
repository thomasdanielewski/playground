import React, { useRef, useState, useCallback } from 'react';
import { Upload } from 'lucide-react';

interface Props {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];

export default function UploadPanel({ onFileSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback((file: File): boolean => {
    if (!ACCEPTED.includes(file.type)) {
      setError('Please upload a valid image (JPG, PNG, WebP).');
      return false;
    }
    setError(null);
    return true;
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validate(file)) onFileSelected(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file && validate(file)) onFileSelected(file);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative group w-full rounded-xl cursor-pointer
          transition-all duration-300 ease-out
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.08)]'
          }
          ${dragOver
            ? 'border-emerald-400/50 bg-emerald-400/5 shadow-[0_0_40px_rgba(16,185,129,0.12)]'
            : 'border-white/[0.06] bg-white/[0.02]'
          }
          border border-dashed p-6 flex flex-col items-center gap-3
        `}
      >
        <div className={`
          p-3 rounded-xl transition-all duration-300
          ${dragOver ? 'bg-emerald-400/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-400 group-hover:text-zinc-200'}
        `}>
          <Upload size={20} strokeWidth={1.5} />
        </div>

        <div className="text-center">
          <p className="text-[13px] font-medium text-zinc-200 tracking-tight">
            {disabled ? 'Processing…' : 'Drop image or click to upload'}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">JPG, PNG, WebP — any resolution</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
          id="image-upload-input"
        />
      </div>

      {error && (
        <p className="text-[11px] text-red-400 text-center animate-fade-in">{error}</p>
      )}
    </div>
  );
}

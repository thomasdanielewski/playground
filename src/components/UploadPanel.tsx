import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Upload } from 'lucide-react';

export interface UploadPanelHandle {
  openPicker: () => void;
}

interface Props {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  multiple?: boolean;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];

const UploadPanel = forwardRef<UploadPanelHandle, Props>(
  ({ onFilesSelected, disabled, compact, multiple }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      openPicker: () => inputRef.current?.click(),
    }));

    const validateAndCollect = useCallback((fileList: FileList | File[]): File[] => {
      const files = Array.from(fileList);
      const valid: File[] = [];
      for (const f of files) {
        if (!ACCEPTED.includes(f.type)) {
          setError('Please upload valid images (JPG, PNG, WebP).');
          return [];
        }
        valid.push(f);
      }
      setError(null);
      return valid;
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const valid = validateAndCollect(e.target.files);
      if (valid.length) onFilesSelected(valid);
      if (inputRef.current) inputRef.current.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const valid = validateAndCollect(e.dataTransfer.files);
      if (valid.length) onFilesSelected(valid);
    };

    return (
      <div className="w-full flex flex-col gap-2">
        <div
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`
            relative group w-full rounded-xl cursor-pointer
            transition-all duration-300 ease-spring
            ${disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.08)]'
            }
            ${dragOver
              ? 'border-emerald-400/50 bg-emerald-400/5 shadow-[0_0_40px_rgba(16,185,129,0.12)]'
              : 'border-white/[0.06] bg-white/[0.02]'
            }
            border border-dashed flex items-center gap-3
            ${compact ? 'p-3 flex-row justify-center' : 'p-6 flex-col'}
          `}
        >
          <div className={`
            rounded-lg transition-all duration-300
            ${compact ? 'p-1.5' : 'p-3 rounded-xl'}
            ${dragOver ? 'bg-emerald-400/10 text-emerald-400' : 'bg-white/[0.06] text-zinc-400 group-hover:text-zinc-200'}
          `}>
            <Upload size={compact ? 16 : 20} strokeWidth={1.5} />
          </div>

          {compact ? (
            <p className="text-[12px] font-medium text-zinc-300 tracking-tight">
              {disabled ? 'Processing...' : 'Upload New Image'}
            </p>
          ) : (
            <div className="text-center">
              <p className="text-[13px] font-medium text-zinc-200 tracking-tight">
                {disabled ? 'Processing...' : 'Drop image or click to upload'}
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">JPG, PNG, WebP — any resolution</p>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleChange}
            disabled={disabled}
            multiple={multiple}
            id="image-upload-input"
          />
        </div>

        {error && (
          <p className="text-[11px] text-red-400 text-center animate-fade-in">{error}</p>
        )}
      </div>
    );
  }
);

UploadPanel.displayName = 'UploadPanel';
export default UploadPanel;

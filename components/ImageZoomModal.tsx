'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';

interface ImageZoomModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  title?: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

const clampScale = (value: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));

export function ImageZoomModal({
  isOpen,
  imageUrl,
  title = 'รูปภาพ',
  onClose,
}: ImageZoomModalProps) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    setScale(1);
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ขยายดูรูปภาพ"
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 sm:text-base">{title}</p>
            <p className="text-xs text-gray-500">ซูม {Math.round(scale * 100)}%</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScale((prev) => clampScale(prev - SCALE_STEP))}
              disabled={scale <= MIN_SCALE}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              -
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              disabled={scale === 1}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              รีเซ็ต
            </button>
            <button
              type="button"
              onClick={() => setScale((prev) => clampScale(prev + SCALE_STEP))}
              disabled={scale >= MAX_SCALE}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              +
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              ปิด
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-auto bg-gray-100 p-3 sm:p-5"
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setScale((prev) =>
              clampScale(prev + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP))
            );
          }}
        >
          <div className="flex min-h-full items-center justify-center">
            <img
              src={imageUrl}
              alt={title}
              className="max-h-[80vh] w-auto max-w-full origin-center rounded-lg border border-gray-200 bg-white object-contain shadow"
              style={{ transform: `scale(${scale})` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

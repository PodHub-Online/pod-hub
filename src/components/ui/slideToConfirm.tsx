"use client";

import React, { useRef, useState } from "react";
import { haptic } from "~/lib/clientStorage";

/**
 * Drag the knob all the way right to confirm. Used for turning the pod off so a stray
 * tap can't do it. Falls back to a confirm on keyboard activation.
 */
export const SlideToConfirm: React.FC<{
  label: string;
  icon: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  /** smaller track for tight spots */
  compact?: boolean;
}> = ({ label, icon, onConfirm, disabled, compact = false }) => {
  const track = useRef<HTMLDivElement | null>(null);
  const start = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const KNOB = compact ? 32 : 48;

  const max = () => (track.current ? track.current.clientWidth - KNOB - 8 : 200);

  const end = () => {
    if (start.current === null) return;
    start.current = null;
    if (offset >= max() * 0.85) {
      haptic(25);
      onConfirm();
    }
    setOffset(0);
  };

  return (
    <div
      ref={track}
      className={`relative w-full select-none overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${compact ? "h-10" : "h-14"} ${disabled ? "opacity-50" : ""}`}
    >
      {/* fill behind the knob */}
      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-200 dark:bg-slate-700" style={{ width: offset + KNOB + 8 }} />
      <span
        className={`pointer-events-none absolute inset-0 flex items-center justify-center font-bold text-slate-500 transition-opacity dark:text-slate-400 ${compact ? "pl-8 text-[11px]" : "pl-10 text-sm"}`}
        style={{ opacity: 1 - offset / Math.max(1, max()) }}
      >
        {label} ›
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          start.current = e.clientX - offset;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          setOffset(Math.max(0, Math.min(max(), e.clientX - start.current)));
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setOffset(0);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && window.confirm(`${label}?`)) onConfirm();
        }}
        className={`absolute left-1 top-1 flex touch-none items-center justify-center rounded-full bg-white text-slate-700 shadow-md dark:bg-slate-600 dark:text-slate-100 ${compact ? "h-8 w-8" : "h-12 w-12"}`}
        style={{ transform: `translateX(${offset}px)`, transition: start.current === null ? "transform .25s" : "none" }}
      >
        {icon}
      </button>
    </div>
  );
};

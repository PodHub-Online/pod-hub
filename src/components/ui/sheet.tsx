"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { tx } from "~/lib/i18n";

/**
 * A panel that slides up from the bottom (a centered box on wide screens). Closes with the X,
 * a tap outside, Escape, or a swipe down on the top bar. Drawn on <body> so a blurred parent
 * (like the sticky header) can't trap it.
 */
export function Sheet({
  open,
  onClose,
  title,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    // keep the page behind from scrolling
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const grab = {
    onPointerDown: (e: React.PointerEvent) => {
      startY.current = e.clientY;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (startY.current !== null) setDrag(Math.max(0, e.clientY - startY.current));
    },
    onPointerUp: () => {
      startY.current = null;
      if (drag > 80) onClose();
      setDrag(0);
    },
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl border border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] text-slate-900 shadow-2xl animate-in slide-in-from-bottom-8 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:rounded-3xl sm:pb-0"
      >
        <div {...grab} className="shrink-0 cursor-grab touch-none px-5 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-lg font-black">
              {icon}
              <span className="truncate">{title}</span>
            </h3>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label={tx("Close")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

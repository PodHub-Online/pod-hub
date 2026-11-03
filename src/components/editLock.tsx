"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { haptic } from "~/lib/clientStorage";
import { useToast } from "~/components/ui/toast";
import { tx } from "~/lib/i18n";

const UNLOCK_MS = 2 * 60_000; // editing stays open for 2 minutes
const HOLD_MS = 1500; // press and hold this long to unlock

interface EditLockCtx {
  unlocked: boolean;
  /** ms left before it locks again */
  remaining: number;
  unlock: () => void;
  lock: () => void;
}

const Ctx = createContext<EditLockCtx>({ unlocked: false, remaining: 0, unlock: () => undefined, lock: () => undefined });

/**
 * Schedule and Settings are set-and-forget, so they open read-only. Holding the lock
 * unlocks editing for 2 minutes; saving, leaving the tab, or the timer locks it again.
 */
export function EditLockProvider({ children, lockKey }: { children: React.ReactNode; lockKey: string }) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const unlocked = until > now;

  useEffect(() => {
    if (!unlocked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [unlocked]);

  // a different tab locks it again
  useEffect(() => setUntil(0), [lockKey]);

  const unlock = useCallback(() => {
    setNow(Date.now());
    setUntil(Date.now() + UNLOCK_MS);
  }, []);
  const lock = useCallback(() => setUntil(0), []);

  const value = useMemo(() => ({ unlocked, remaining: Math.max(0, until - now), unlock, lock }), [unlocked, until, now, unlock, lock]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEditLock = () => useContext(Ctx);

/** The lock button: hold to unlock (a ring fills), tap to lock again while editing. */
export const LockButton: React.FC = () => {
  const { unlocked, remaining, unlock, lock } = useEditLock();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (unlocked) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      haptic(30);
      unlock();
    }, HOLD_MS);
  };
  const stop = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
  };

  if (unlocked) {
    const s = Math.ceil(remaining / 1000);
    return (
      <button
        type="button"
        onClick={lock}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <LockOpen className="h-4 w-4" />
        {tx("Editing")} · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
        <span className="ml-1 underline">{tx("Lock")}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="relative inline-flex h-9 select-none items-center gap-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white/80 px-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
      style={{ touchAction: "none" }}
    >
      {/* fills up while you hold */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-slate-200 dark:bg-slate-700"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${HOLD_MS}ms linear` : "width 150ms" }}
      />
      <Lock className="relative h-4 w-4" />
      <span className="relative">{tx("Hold to edit")}</span>
    </button>
  );
};

/** Wraps things that change settings: read-only (grayed, untappable) while locked. */
export const Locked: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const { unlocked } = useEditLock();
  const toast = useToast();
  return (
    <div className={`relative ${className ?? ""}`}>
      <div aria-disabled={!unlocked} className={unlocked ? "" : "pointer-events-none select-none opacity-60"}>
        {children}
      </div>
      {!unlocked && (
        // a tap on locked content explains how to unlock instead of doing nothing
        <button
          type="button"
          aria-label={tx("Locked. Hold the lock at the top to edit.")}
          onClick={() => toast(tx("Locked. Hold the lock at the top to edit."), "info")}
          className="absolute inset-0 cursor-not-allowed"
        />
      )}
    </div>
  );
};

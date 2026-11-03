"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BedDouble, CalendarClock, LineChart, Settings, SlidersHorizontal, SplitSquareHorizontal } from "lucide-react";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { tx } from "~/lib/i18n";
import { apiR } from "~/trpc/react";

export const TOUR_KEY = "podhub-tour-seen";

/** Each step points at a part of Home marked with data-tour="…" (it scrolls there and lights it up). */
const STEPS = [
  { target: "bed", icon: BedDouble, title: "Your bed", body: "Spin the 3D bed with a finger. Tap a side to pick it. Each side shows its temperature and where it's heading." },
  { target: "sides", icon: SplitSquareHorizontal, title: "Pick a side", body: "Swipe sideways, or tap these dots, to switch between Left, Right and the whole bed." },
  { target: "control", icon: SlidersHorizontal, title: "Change it now", body: "Tap − or + to change the temperature right away. The schedule picks up again at its next step." },
  { target: "curve", icon: LineChart, title: "Tonight's curve", body: "What the Pod will do tonight, step by step. On the Sleep tab you'll see what it actually did." },
  { target: "tab-schedule", icon: CalendarClock, title: "Your night", body: "The Schedule tab sets the levels for falling asleep, deep sleep, late sleep and a warm wake-up. Hold the lock to edit." },
  { target: "settings", icon: Settings, title: "Settings", body: "Tap the app icon for Settings: light or dark, °F or °C, hot nights, travel, notifications, and this tour again." },
];

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8;

/** A short tour the first time someone signs in (and again from Settings → Smart features). */
export const FirstTour: React.FC = () => {
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  // owner statistics: who finishes the tour, and where people skip it
  const report = apiR.stats.track.useMutation();

  useEffect(() => {
    if (!readStorage(TOUR_KEY)) setStep(0);
    const again = () => {
      window.scrollTo({ top: 0 });
      setStep(0);
    };
    window.addEventListener("podhub-tour", again);
    return () => window.removeEventListener("podhub-tour", again);
  }, []);

  const measure = useCallback(() => {
    if (step === null) return;
    const el = document.querySelector(`[data-tour="${STEPS[step]!.target}"]`);
    const r = el?.getBoundingClientRect();
    setView({ w: window.innerWidth, h: window.innerHeight });
    setBox(r && r.width > 0 && r.height > 0 ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null);
  }, [step]);

  // bring the step's part of the screen into view, then light it up
  useLayoutEffect(() => {
    if (step === null) return;
    const el = document.querySelector(`[data-tour="${STEPS[step]!.target}"]`);
    // the bottom bar and header are always on screen; anything else scrolls to the middle
    if (el && !el.closest("nav, header")) el.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const t1 = setTimeout(measure, 350);
    const t2 = setTimeout(measure, 800);
    const t3 = setTimeout(measure, 1600);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [step, measure]);

  if (step === null || typeof document === "undefined") return null;
  const done = (skipped = false) => {
    report.mutate(skipped ? { kind: "tour_skipped", meta: String(step + 1) } : { kind: "tour_done" });
    writeStorage(TOUR_KEY, "1");
    setStep(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const s = STEPS[step]!;
  const Icon = s.icon;
  const last = step + 1 === STEPS.length;

  // the card goes below the lit-up part when there's room, else above it (or centered when there's no target)
  const CARD_H = 230;
  const below = box ? box.top + box.height + 12 + CARD_H < view.h : true;
  const cardStyle: React.CSSProperties = !box
    ? { left: 16, right: 16, bottom: 24 }
    : below
    ? { left: 16, right: 16, top: Math.max(12, box.top + box.height + 12) }
    : { left: 16, right: 16, top: Math.max(12, box.top - 12 - CARD_H) };

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={tx(s.title)}>
      {/* the dimmed screen with a hole over the part this step is about */}
      {box ? (
        <div
          className="pointer-events-none fixed rounded-3xl ring-2 ring-white/80 transition-all duration-300"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgba(2,6,23,0.72)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-950/70" />
      )}
      {/* clicks outside the card don't reach the app while the tour is open */}
      <div className="fixed inset-0" />
      <div
        className="fixed mx-auto max-w-sm rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
        style={cardStyle}
      >
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("{n} of {total}", { n: step + 1, total: STEPS.length })}</p>
            <h3 className="text-lg font-black leading-tight">{tx(s.title)}</h3>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{tx(s.body)}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-4 bg-indigo-600" : "w-1.5 bg-slate-300 dark:bg-slate-700"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <button type="button" onClick={() => setStep(step - 1)} className="h-10 rounded-2xl px-3 text-xs font-bold text-slate-500">
                {tx("Back")}
              </button>
            ) : (
              <button type="button" onClick={() => done(true)} className="h-10 rounded-2xl px-3 text-xs font-bold text-slate-500">
                {tx("Skip")}
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? done() : setStep(step + 1))}
              className="h-10 rounded-2xl bg-indigo-600 px-5 text-xs font-extrabold text-white transition active:scale-95"
            >
              {last ? tx("Got it") : tx("Next")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

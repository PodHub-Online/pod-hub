"use client";

import React from "react";
import { Thermometer } from "lucide-react";
import { setLevelDisplay, setTempUnit, useLevelDisplay, useLevelFormat, useTempUnit, type LevelDisplay, type TempUnit } from "~/lib/tempUnit";
import { tx } from "~/lib/i18n";

/** °F / °C for every temperature in the app (bed labels, sleep data). */
export const UnitPicker: React.FC = () => {
  const unit = useTempUnit();
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-slate-200/80 bg-white/90 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/70">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
        <Thermometer className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-extrabold text-slate-900 dark:text-slate-200">{tx("Temperature")}</span>
      <div className="inline-flex rounded-xl border border-slate-200 bg-white/80 p-1 dark:border-slate-800 dark:bg-slate-900/80">
        {(["f", "c"] as TempUnit[]).map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setTempUnit(u)}
            aria-pressed={unit === u}
            className={`h-7 rounded-lg px-3 text-xs font-bold transition ${
              unit === u ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            °{u.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Schedule levels as Pod levels (-10…+10), temperatures (one-degree steps), or both. */
export const LevelDisplayPicker: React.FC = () => {
  const mode = useLevelDisplay();
  const unit = useTempUnit();
  const sample = useLevelFormat();
  const options: { id: LevelDisplay; label: string; example: string }[] = [
    { id: "levels", label: tx("Levels"), example: "+2" },
    { id: "temp", label: tx("Temperature"), example: `87°${unit.toUpperCase()}` },
    { id: "both", label: tx("Both"), example: "+2 · 87°" },
  ];
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/90 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/70">
      <div className="text-sm font-extrabold text-slate-900 dark:text-slate-200">{tx("Show schedule levels as")}</div>
      <div className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        {sample.mode === "levels"
          ? tx("Schedule, presets and tonight's curve. − / + move one Pod level.")
          : tx("Schedule, presets and tonight's curve. − / + move one degree, {min}–{max}.", unit === "f" ? { min: "55°F", max: "110°F" } : { min: "13°C", max: "43°C" })}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white/80 p-1 dark:border-slate-800 dark:bg-slate-900/80">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setLevelDisplay(o.id)}
            aria-pressed={mode === o.id}
            className={`rounded-lg px-2 py-1.5 text-xs font-bold leading-tight transition ${
              mode === o.id ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {o.label}
            <span className="block text-[10px] font-semibold opacity-70">{o.example}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

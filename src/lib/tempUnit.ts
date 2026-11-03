"use client";

import { useEffect, useState } from "react";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { displayDegrees, stepDegree, stepLevel } from "~/lib/bedTemp";
import { formatLevel } from "~/lib/presets";
import { tx } from "~/lib/i18n";

export type { TempUnit } from "~/lib/bedTemp";
import type { TempUnit } from "~/lib/bedTemp";

const KEY = "podhub-unit";
const EVENT = "podhub-unit-change";

const read = (): TempUnit => (readStorage(KEY) === "c" ? "c" : "f");

/** Saves °F / °C for this device and tells every open view (including the 3D bed labels). */
export function setTempUnit(unit: TempUnit) {
  writeStorage(KEY, unit);
  window.dispatchEvent(new Event(EVENT));
}

/** The chosen temperature unit; updates when it's changed in Settings. */
export function useTempUnit(): TempUnit {
  const [unit, setUnit] = useState<TempUnit>("f");
  useEffect(() => {
    setUnit(read());
    const onChange = () => setUnit(read());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return unit;
}

/** 76.4 °F → "76°" or "24.7°" depending on the unit. */
export const formatTemp = (f: number | null | undefined, unit: TempUnit) =>
  f === null || f === undefined ? "—" : unit === "c" ? `${(((f - 32) * 5) / 9).toFixed(1)}°` : `${Math.round(f)}°`;

/** A Celsius reading (weather, the Pod's room sensor) in the chosen unit: "26.4°C" or "80°F". */
export const formatC = (c: number | null | undefined, unit: TempUnit, digits = 1) =>
  c === null || c === undefined ? "—" : unit === "c" ? `${c.toFixed(digits)}°C` : `${Math.round(c * 1.8 + 32)}°F`;

// ---------- Schedule levels as Pod levels or temperatures ----------

/** How schedule levels are shown: Pod levels (-10…+10), temperatures, or both. */
export type LevelDisplay = "levels" | "temp" | "both";

const DISPLAY_KEY = "podhub-level-display";
const DISPLAY_EVENT = "podhub-level-display-change";

const readDisplay = (): LevelDisplay => {
  const v = readStorage(DISPLAY_KEY);
  return v === "temp" || v === "both" ? v : "levels";
};

/** Saves Levels / Temperature / Both for this device and tells every open view. */
export function setLevelDisplay(mode: LevelDisplay) {
  writeStorage(DISPLAY_KEY, mode);
  window.dispatchEvent(new Event(DISPLAY_EVENT));
}

export function useLevelDisplay(): LevelDisplay {
  const [mode, setMode] = useState<LevelDisplay>("levels");
  useEffect(() => {
    setMode(readDisplay());
    const onChange = () => setMode(readDisplay());
    window.addEventListener(DISPLAY_EVENT, onChange);
    return () => window.removeEventListener(DISPLAY_EVENT, onChange);
  }, []);
  return mode;
}

/**
 * Shows and steps schedule levels the way this device asks for. Levels: "-4", steps of one level.
 * Temperature / Both: "72°F", steps of one degree (Both also gives "level -4" underneath).
 */
export function useLevelFormat() {
  const unit = useTempUnit();
  const mode = useLevelDisplay();
  const degrees = mode !== "levels";
  const deg = (raw: number) => `${displayDegrees(raw, unit)}°${unit.toUpperCase()}`;
  const level = (raw: number) => formatLevel(Math.round(raw));
  return {
    mode,
    unit,
    /** the main text for a level: "-4" or "72°F" */
    text: (raw: number | null) => (raw === null ? tx("Off") : degrees ? deg(raw) : level(raw)),
    /** small text under it in Both mode: "level -4" */
    sub: (raw: number | null) => (raw === null || mode !== "both" ? null : tx("level {level}", { level: level(raw) })),
    /** compact, for curves and lists: "-4", "72°" */
    short: (raw: number | null) => (raw === null ? tx("Off") : degrees ? `${displayDegrees(raw, unit)}°` : level(raw)),
    /** one step warmer (+1) or cooler (-1): a degree, or a level */
    step: (raw: number, dir: 1 | -1) => (degrees ? stepDegree(raw, unit, dir) : stepLevel(raw, dir)),
  };
}

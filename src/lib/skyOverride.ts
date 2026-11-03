// TEMPORARY, for showing the sky behind the 3D bed: "Demo weather" steps through made-up weathers.
// To remove it: delete this file and src/components/skySimulator.tsx, the "Administrator" page in
// src/components/settingsPanel.tsx (marked DEMO-WEATHER), and the lines marked SKY-SIMULATOR in
// src/components/useSky.ts and src/components/bedDiagram.tsx.
import { useSyncExternalStore } from "react";
import type { Condition, Phase } from "~/lib/sky";
import { readStorage, writeStorage } from "~/lib/clientStorage";

export interface SkyOverride {
  condition?: Condition;
  phase?: Phase;
  /** 0…1 (0 new, 0.5 full) */
  moon?: number;
  tempC?: number;
  /** "hot" / "cold" pick a temperature that triggers it */
  extreme?: "hot" | "cold";
}

/** The weathers "Demo weather" steps through, one tap each, then back to the real sky. */
export const DEMO_WEATHERS: { label: string; override: SkyOverride }[] = [
  { label: "Clear · Day", override: { condition: "clear", phase: "day", tempC: 24 } },
  { label: "Clear · Night", override: { condition: "clear", phase: "night", moon: 0.5, tempC: 14 } },
  { label: "Partly cloudy · Day", override: { condition: "partly", phase: "day", tempC: 21 } },
  { label: "Cloudy · Dusk", override: { condition: "cloudy", phase: "dusk", tempC: 17 } },
  { label: "Rain · Night", override: { condition: "rain", phase: "night", moon: 0.88, tempC: 12 } },
  { label: "Thunderstorm · Night", override: { condition: "thunder", phase: "night", moon: 0.1, tempC: 18 } },
  { label: "Snow · Day", override: { condition: "snow", phase: "day", tempC: -2 } },
  { label: "Fog · Dawn", override: { condition: "fog", phase: "dawn", tempC: 9 } },
  { label: "Hot · Day", override: { condition: "clear", phase: "day", extreme: "hot" } },
  { label: "Very cold · Night", override: { condition: "clear", phase: "night", moon: 0.3, extreme: "cold" } },
];

let current: SkyOverride | null = null;
let step = -1; // -1 = the real sky
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useSkyOverride(): SkyOverride | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
export function useDemoWeatherStep(): number {
  return useSyncExternalStore(subscribe, () => step, () => -1);
}

/** One tap: the next weather; after the last one, back to the real sky. */
export function nextDemoWeather() {
  step = step + 1 >= DEMO_WEATHERS.length ? -1 : step + 1;
  current = step < 0 ? null : DEMO_WEATHERS[step]!.override;
  emit();
}
export function stopDemoWeather() {
  step = -1;
  current = null;
  emit();
}

// The administrator's on / off for "Demo weather" (Settings → Administrator), saved on this device.
const KEY = "podhub-demo-weather";
const EVENT = "podhub-demo-weather-change";
export function setDemoWeatherEnabled(on: boolean) {
  writeStorage(KEY, on ? "1" : null);
  if (!on) stopDemoWeather();
  window.dispatchEvent(new Event(EVENT));
}
export function useDemoWeatherEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    () => readStorage(KEY) === "1",
    () => false,
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { apiR } from "~/trpc/react";
import { computeSky, todaySun, type SkyDetail, type SkyState } from "~/lib/sky";
import { useSkyOverride } from "~/lib/skyOverride"; // SKY-SIMULATOR

/** The sky for the 3D bed: the real forecast at home (when saved), else just day / night from the phone's clock. */
export type SkyView = SkyState & { detail: SkyDetail | null };

export function useSky(): SkyView {
  const q = apiR.fun.getSky.useQuery(undefined, { staleTime: 30 * 60_000, retry: false, refetchInterval: 30 * 60_000 });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const override = useSkyOverride(); // SKY-SIMULATOR

  const sky = useMemo(() => {
    const w = q.data;
    const real = computeSky({
      now,
      sun: w ? { rise: w.rise.map((d) => new Date(d)), set: w.set.map((d) => new Date(d)) } : null,
      code: w?.code ?? null,
      tempC: w?.tempC ?? null,
      lowC: w?.lowC ?? null,
      rainPct: w?.rainPct ?? null,
    });
    // SKY-SIMULATOR (start)
    if (override) {
      const tempC = override.extreme === "hot" ? 38 : override.extreme === "cold" ? -12 : override.tempC ?? real.tempC ?? 21;
      const phase = override.phase ?? real.phase;
      const forced = override.phase ? { phase, body: phase === "night" ? ("moon" as const) : ("sun" as const), progress: phase === "dawn" ? 0.04 : phase === "dusk" ? 0.96 : 0.5 } : {};
      return {
        ...real,
        ...forced,
        condition: override.condition ?? real.condition,
        moon: override.moon ?? real.moon,
        tempC,
        lowC: tempC - 3,
        rainPct: (override.condition ?? real.condition) === "rain" || (override.condition ?? real.condition) === "thunder" ? 80 : real.rainPct,
        extreme: override.extreme ?? (tempC >= 35 ? "hot" : tempC <= -7 ? "cold" : null),
        hasWeather: true,
      };
    }
    // SKY-SIMULATOR (end)
    return real;
  }, [q.data, now, override]);
  const real = q.data;
  const detail = useMemo<SkyDetail | null>(() => {
    if (!real) return null;
    const rise = real.rise.map((d) => new Date(d));
    const set = real.set.map((d) => new Date(d));
    return { hours: real.hours.map((h) => ({ at: new Date(h.at), tempC: h.tempC, code: h.code })), humidity: real.humidity, ...todaySun(rise, set), tomorrow: real.tomorrow };
  }, [real]);
  return useMemo(() => ({ ...sky, detail }), [sky, detail]);
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { apiR } from "~/trpc/react";
import { Skeleton } from "~/components/ui/card";
import { formatLevel } from "~/lib/presets";
import { formatTemp, useLevelFormat, useTempUnit } from "~/lib/tempUnit";
import { useSky, type SkyView } from "~/components/useSky";
import { zoneCity } from "~/components/scheduleZone";
import { deviceZone } from "~/lib/scheduleTime";
import { SkySimulator } from "~/components/skySimulator"; // SKY-SIMULATOR
import { CONDITION_EMOJI, CONDITION_LABEL, celsiusToF, conditionFromCode, moonName, skyEmoji, skyNumberC, type SkyState } from "~/lib/sky";
import { tx, txLocale } from "~/lib/i18n";
import { haptic } from "~/lib/clientStorage";
import { useToast } from "~/components/ui/toast";
import { useSide } from "~/components/sideContext";
import { useTheme } from "~/components/themeProvider";
import { bedEngraving } from "~/lib/appName";
import { useScheduleStatus, useTonight } from "~/components/sideStatus";
import { ConnectionSheet } from "~/components/connectionButton";

export type Mode = "off" | "cooling" | "warming" | "holding-cool" | "holding-warm" | "holding";

export interface SideState {
  side: "left" | "right";
  level: number | null;
  target: number | null;
  active: boolean | null;
  isYou: boolean;
  tempF: number | null;
  targetTempF: number | null;
}

export function modeOf(s: SideState | undefined): Mode {
  if (!s?.active) return "off";
  const level = s.level ?? 0;
  const target = s.target ?? level;
  if (target - level > 3) return "warming";
  if (level - target > 3) return "cooling";
  return target < 0 ? "holding-cool" : target > 0 ? "holding-warm" : "holding";
}

// Shared with the 3D model; kept here so Home doesn't load three.js just for colors
export const MODE_COLOR: Record<Mode, string> = {
  off: "#64748b",
  cooling: "#22d3ee",
  "holding-cool": "#38bdf8",
  warming: "#ef4444",
  "holding-warm": "#f97316",
  holding: "#818cf8",
};

export function describe(mode: Mode, s: SideState | undefined) {
  const target = s?.target !== null && s?.target !== undefined ? formatLevel(s.target) : "—";
  switch (mode) {
    case "off":
      return "Off";
    case "cooling":
      return `Cooling to ${target}`;
    case "warming":
      return `Warming to ${target}`;
    default:
      return `Holding ${target}`;
  }
}

const Bed3D = dynamic(() => import("~/components/bed3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});


/** The colours behind the bed for this sky (kept dark enough to read the bed's labels). */
function skyGradient(s: SkyState): string {
  const pair = (a: string, b: string) => `linear-gradient(180deg, ${a}, ${b})`;
  if (s.phase === "dawn") return pair("#3b2a4d", "#b8735a");
  if (s.phase === "dusk") return pair("#2b2350", "#a85a45");
  const night = s.phase === "night";
  switch (s.condition) {
    case "clear":
      return night ? pair("#050914", "#0e1730") : pair("#2f6fb0", "#4f86b3");
    case "partly":
      return night ? pair("#070b16", "#122038") : pair("#3a78b4", "#5a8fb6");
    case "cloudy":
      return night ? pair("#0a0e18", "#171e2c") : pair("#434d5b", "#5b6676");
    case "rain":
    case "thunder":
      return night ? pair("#080b13", "#121926") : pair("#38414e", "#515c6b");
    case "snow":
      return night ? pair("#0c111c", "#1c2535") : pair("#5a6676", "#7a8798");
    case "fog":
      return night ? pair("#0f1520", "#252d3b") : pair("#6b7584", "#8b95a3");
  }
}

/**
 * The weather: the icon and temperature sit next to the sun / moon inside the 3D scene (a label, below), and the
 * city stays bottom-right. Tapping either opens the forecast pop-up, which drops from the top-right.
 */
function useSkyWeather(sky: SkyView) {
  const unit = useTempUnit();
  const c = skyNumberC(sky);
  const deg = (v: number) => formatTemp(celsiusToF(v), unit);
  const rain = (sky.condition === "rain" || sky.condition === "thunder") && sky.rainPct !== null ? ` · ${Math.round(sky.rainPct)}%` : "";
  const text = c !== null ? `${skyEmoji(sky)} ${deg(c)}${rain}` : null;
  return { deg, text };
}

function SkyForecast({ sky, open, onClose }: { sky: SkyView; open: boolean; onClose: () => void }) {
  const { deg } = useSkyWeather(sky);
  const city = zoneCity(deviceZone());
  const d = sky.detail;
  const time = (x: Date, minutes = false) => x.toLocaleTimeString(txLocale(), minutes ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" });
  const emojiAt = (code: number, at: Date) => {
    const cond = conditionFromCode(code);
    const h = at.getHours();
    return cond === "clear" && (h >= 19 || h < 7) ? "🌙" : CONDITION_EMOJI[cond];
  };
  if (!open) return null;
  return (
    <>
      <div className="absolute inset-0 z-10" onClick={onClose} aria-hidden />
      <div className="absolute right-3 top-12 z-20 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-white/15 bg-slate-900/95 p-2.5 text-[10px] font-semibold leading-snug text-slate-200 shadow-xl backdrop-blur">
        <span className="absolute -top-1.5 right-10 h-3 w-3 rotate-45 border-l border-t border-white/15 bg-slate-900" />
        <p className="text-xs font-extrabold text-white">
          {skyEmoji(sky)} {tx(CONDITION_LABEL[sky.condition])}
          {sky.tempC !== null ? ` · ${deg(sky.tempC)}` : ""}
          {city ? ` · ${city}` : ""}
        </p>
        <p className="mt-0.5">
          {sky.lowC !== null && (
            <>
              {tx("Low tonight")} <b className="text-white">{deg(sky.lowC)}</b>
            </>
          )}
          {sky.rainPct !== null && (
            <>
              {" · "}
              {tx("Rain")} <b className="text-white">{Math.round(sky.rainPct)}%</b>
            </>
          )}
          {d?.humidity != null && (
            <>
              {" · "}
              {tx("Humidity")} <b className="text-white">{Math.round(d.humidity)}%</b>
            </>
          )}
        </p>
        {d && d.hours.length > 0 && (
          <div className="mt-1.5 flex gap-1">
            {d.hours.map((h) => (
              <div key={h.at.toISOString()} className="flex-1 rounded-lg bg-white/10 py-0.5 text-center text-[9px] leading-tight">
                {time(h.at)}
                <b className="block text-[10px] text-white">{deg(h.tempC)}</b>
                <span>{emojiAt(h.code, h.at)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 opacity-75">
          {d?.sunrise && d.sunset ? `↑ ${time(d.sunrise, true)} · ↓ ${time(d.sunset, true)} · ` : ""}
          {tx(moonName(sky.moon))}
          {d?.tomorrow ? ` · ${tx("Tomorrow")} ${CONDITION_EMOJI[conditionFromCode(d.tomorrow.code)]} ${deg(d.tomorrow.loC)} / ${deg(d.tomorrow.hiC)}` : ""}
        </p>
      </div>
    </>
  );
}

/** The city name, bottom-right of the bed, as glowing text like the bed's readouts. */
function SkyCity({ sky, onTap }: { sky: SkyView; onTap: () => void }) {
  const city = zoneCity(deviceZone());
  if (!city || !sky.hasWeather) return null;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={tx("Weather forecast")}
      className="absolute bottom-3 right-3 z-20 font-hud text-[9px] font-bold uppercase leading-tight tracking-wider text-slate-100/85 active:opacity-70"
      style={{ textShadow: "0 1px 3px rgba(0,0,0,.9)" }}
    >
      {city}
    </button>
  );
}

/** Live 3D bed for the Home screen: drag to turn it, tap a side to control it. */
export const BedDiagram: React.FC = () => {
  const health = apiR.user.getPodHealth.useQuery(undefined, { retry: false, refetchInterval: 10_000 });
  const { selected, select } = useSide();
  const { resolvedTheme } = useTheme();
  // "ALEX'S BED" on the headboard, from the name in Settings → Preferences
  const engraving = bedEngraving(apiR.user.getAccount.useQuery().data?.displayName);
  const scheduleStatus = useScheduleStatus();
  const tonight = useTonight();
  const sky = useSky();
  const { text: weatherText } = useSkyWeather(sky);
  const [forecast, setForecast] = useState(false);
  // tapping the Pod in the 3D view shows the same panel as tapping the pod name
  const [connOpen, setConnOpen] = useState(false);

  // Tap the temperature on the bed: a − / + bubble. Taps wait a moment so 3 taps = 1 change (as on the Temperature card).
  const fmt = useLevelFormat();
  const toast = useToast();
  const utils = apiR.useUtils();
  type TagSide = "left" | "right" | "both";
  const [open, setOpen] = useState<TagSide | null>(null);
  const [pending, setPending] = useState<Partial<Record<TagSide, number>>>({});
  const timers = useRef<Partial<Record<TagSide, ReturnType<typeof setTimeout>>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => {
      Object.values(timers.current).forEach((t) => t && clearTimeout(t));
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const refresh = () => Promise.all([utils.user.getPodStatus.invalidate(), utils.user.getPodHealth.invalidate(), utils.user.getAccount.invalidate()]);
  const setLevel = apiR.user.setPodTargetLevel.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await refresh();
      setPending((p) => ({ ...p, [vars.side ?? "left"]: undefined }));
    },
    onError: (e, vars) => {
      setPending((p) => ({ ...p, [vars.side ?? "left"]: undefined }));
      toast(e.message, "error");
    },
  });
  const setPower = apiR.user.setPodPower.useMutation({
    onSuccess: refresh,
    onError: (e) => toast(e.message, "error"),
  });
  const keepOpen = (side: TagSide) => {
    setOpen(side);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 6000);
  };

  if (health.isLoading) return <Skeleton className="h-56" />;
  if (!health.data) return null;

  const h = health.data;
  const wholeBed = selected === "both";
  // each side's schedule state under its temperature (whole bed follows the Left schedule)
  const noteFor = (side: "left" | "right") => {
    const st = scheduleStatus(side, !!h.sides.find((s) => s.side === side)?.active);
    return st ? { text: st.short, tone: st.tone } : undefined;
  };
  const notes = { left: noteFor("left"), right: noteFor("right") };
  const adjustFor = (tag: TagSide) => {
    const src = h.sides.find((x) => x.side === (tag === "right" ? "right" : "left"));
    const target = src?.target ?? src?.level ?? 0;
    const shown = pending[tag] ?? target;
    const isOn = !!src?.active;
    return {
      open: open === tag,
      raw: pending[tag] ?? null,
      text: fmt.text(shown),
      isOn,
      onTap: () => {
        if (open === tag) return setOpen(null);
        keepOpen(tag);
      },
      onPower: () => {
        haptic();
        keepOpen(tag);
        setPower.mutate({ isOn: !isOn, side: tag });
      },
      onStep: (delta: 1 | -1) => {
        haptic();
        keepOpen(tag);
        const next = fmt.step(shown, delta);
        setPending((p) => ({ ...p, [tag]: next }));
        const t = timers.current[tag];
        if (t) clearTimeout(t);
        timers.current[tag] = setTimeout(() => {
          if (next === target) return setPending((p) => ({ ...p, [tag]: undefined }));
          setLevel.mutate({ level: next, turnOn: !isOn ? true : undefined, side: tag });
        }, 1800);
      },
    };
  };
  const adjust = wholeBed ? { both: adjustFor("both") } : { left: adjustFor("left"), right: adjustFor("right") };

  return (
    // the stage follows the theme: a soft gray room in light mode, a dark one in dark mode
    <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-200 shadow-sm dark:border-slate-800/80 dark:from-slate-800 dark:to-slate-950">
      {/* the sky: the colours follow the time of day and the weather */}
      <div className="pointer-events-none absolute inset-0 transition-[background] duration-1000" style={{ background: skyGradient(sky) }} />
      <SkyCity sky={sky} onTap={() => setForecast((v) => !v)} />
      <SkyForecast sky={sky} open={forecast} onClose={() => setForecast(false)} />
      <SkySimulator /> {/* SKY-SIMULATOR */}
      <div className="relative h-56 w-full">
        <Bed3D
          sides={h.sides}
          wholeBed={wholeBed}
          online={h.online}
          led={h.ledBrightnessLevel}
          selected={wholeBed ? "left" : selected}
          notes={notes}
          // tapping a side picks it on the top bar (in Both the bed is one zone)
          onSelect={(side) => {
            if (side && !wholeBed) select(side);
          }}
          engraving={engraving}
          backEngraving={engraving}
          theme={resolvedTheme}
          moon={(["left", "right", "both"] as const).some((s) => tonight(s)?.runs)}
          sky={sky}
          skyLabel={weatherText ? { text: weatherText, aria: tx("Weather forecast"), onTap: () => setForecast((v) => !v) } : undefined}
          onHubTap={() => setConnOpen(true)}
          adjust={adjust}
        />
      </div>
      <ConnectionSheet open={connOpen} onClose={() => setConnOpen(false)} />
    </section>
  );
};

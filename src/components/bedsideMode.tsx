"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiR } from "~/trpc/react";
import {
  X,
  Power,
  Snowflake,
  Flame,
  Moon,
  Wind,
} from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";
import { nightstandTitle } from "~/lib/appName";
import { formatTemp, useLevelFormat, useTempUnit } from "~/lib/tempUnit";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { useSide } from "~/components/sideContext";

/** Which side this phone's nightstand controls (saved on this phone only). */
const NIGHTSTAND_SIDE_KEY = "podhub-nightstand-side";

function formatLevel(level: number): string {
  const scaled = level / 10;
  return scaled > 0 ? `+${scaled}` : `${scaled}`;
}

interface BedsideModeProps {
  onClose: () => void;
}

/** Fixed, slowly twinkling stars (the same every time, so nothing jumps around). */
const STARS = Array.from({ length: 40 }, (_, i) => {
  const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 70, size: 1 + r(3) * 1.6, delay: r(4) * 6, dur: 3 + r(5) * 4 };
});

export const BedsideMode: React.FC<BedsideModeProps> = ({ onClose }) => {
  const [currentTime, setCurrentTime] = useState<string>("");
  // "Good night": only the dimmed clock and stars; tap anywhere to bring the buttons back
  const [sleeping, setSleeping] = useState(false);
  const unit = useTempUnit();

  // The phone's Back gesture (and Escape) closes the nightstand instead of leaving the app
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ podhubNightstand: true }, "");
    const onPop = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const close = () => {
    if ((window.history.state as { podhubNightstand?: boolean } | null)?.podhubNightstand) window.history.back();
    else closeRef.current();
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const utils = apiR.useUtils();
  // Each phone picks its own side (you on yours, your partner on theirs); until someone picks, it is the side the signed-in account sleeps on.
  const { own } = useSide();
  const [picked, setPicked] = useState<"left" | "right" | null>(null);
  useEffect(() => {
    const saved = readStorage(NIGHTSTAND_SIDE_KEY);
    if (saved === "left" || saved === "right") setPicked(saved);
  }, []);
  const side: "left" | "right" = picked ?? own;
  const chooseSide = (next: "left" | "right") => {
    setPicked(next);
    writeStorage(NIGHTSTAND_SIDE_KEY, next);
  };
  const podStatusQuery = apiR.user.getPodStatus.useQuery(
    { side },
    {
      refetchInterval: 3_000,
    },
  );

  const status = podStatusQuery.data;
  const isOn = status?.isOn ?? false;
  const currentTarget = Math.round(status?.targetHeatingLevel ?? status?.heatingLevel ?? 0);
  // one level or one degree per tap, as chosen in Settings → Preferences
  const fmt = useLevelFormat();

  const setPowerMutation = apiR.user.setPodPower.useMutation({
    onSuccess: async () => {
      await utils.user.getPodStatus.invalidate();
    },
  });

  const setTargetLevelMutation = apiR.user.setPodTargetLevel.useMutation({
    onSuccess: async () => {
      await utils.user.getPodStatus.invalidate();
    },
  });

  const handleAdjust = (delta: number) => {
    const next = fmt.step(currentTarget, delta > 0 ? 1 : -1);
    setTargetLevelMutation.mutate({
      level: next,
      turnOn: !isOn ? true : undefined,
      side,
    });
  };

  const modesQuery = apiR.user.getQuickModes.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const quickMode = apiR.user.setQuickMode.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.user.getQuickModes.invalidate(), utils.user.getPodStatus.invalidate()]);
    },
  });
  const hotFlash = modesQuery.data?.hotFlash;

  const handleTogglePower = () => {
    setPowerMutation.mutate({ isOn: !isOn, side });
  };

  const displayName = apiR.user.getAccount.useQuery().data?.displayName;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-black p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] text-amber-500/90 select-none animate-in fade-in duration-300"
      onClick={() => sleeping && setSleeping(false)}
    >
      <style>{`@keyframes podhub-twinkle { 0%, 100% { opacity: .15 } 50% { opacity: .8 } }`}</style>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {STARS.map((st, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-amber-100 motion-reduce:!animate-none"
            style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.size, height: st.size, animation: `podhub-twinkle ${st.dur}s ease-in-out ${st.delay}s infinite` }}
          />
        ))}
      </div>
      {/* Top Header */}
      <div className={`relative flex items-center justify-between transition-opacity duration-700 ${sleeping ? "pointer-events-none opacity-0" : ""}`}>
        <div className="flex items-center space-x-2 text-amber-500/60">
          <Moon className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-widest">
            {nightstandTitle(displayName)}
          </span>
        </div>

        <button
          type="button"
          onClick={close}
          className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-amber-500/30 px-4 text-sm font-bold text-amber-500/80 transition hover:bg-amber-500/20 active:scale-95"
        >
          <X className="h-4 w-4" />
          {tx("Exit")}
        </button>
      </div>

      {/* Which side this phone controls */}
      <div className={`relative mx-auto flex gap-1 rounded-full border border-amber-500/30 p-1 transition-opacity duration-700 ${sleeping ? "pointer-events-none opacity-0" : ""}`} role="radiogroup" aria-label={tx("Side this phone controls")}>
        {(["left", "right"] as const).map((sd) => (
          <button
            key={sd}
            type="button"
            role="radio"
            aria-checked={side === sd}
            onClick={(e) => {
              e.stopPropagation();
              chooseSide(sd);
            }}
            className={`h-9 rounded-full px-6 text-sm font-bold transition active:scale-95 ${side === sd ? "bg-amber-500/25 text-amber-300" : "text-amber-500/50"}`}
          >
            {tx(sd === "left" ? "Left" : "Right")}
          </button>
        ))}
      </div>

      {/* Clock and Temperature Centerpiece */}
      <div className={`relative flex flex-col items-center justify-center space-y-4 transition-opacity duration-700 ${sleeping ? "opacity-30" : ""}`}>
        {/* Soft Amber Dim Digital Clock */}
        <div className="text-7xl sm:text-8xl font-thin tracking-widest text-amber-400/90 drop-shadow-[0_0_20px_rgba(245,158,11,0.2)]">
          {currentTime || "12:00"}
        </div>

        {/* Live Surface Temp & Target Readout */}
        <div className="flex items-center space-x-4 text-sm font-semibold text-amber-500/80">
          <span>
            {tx("Surface:")}{" "}
            {status?.temperatureF !== null && status?.temperatureF !== undefined
              ? `${formatTemp(status.temperatureF, unit)}${unit === "c" ? "C" : "F"}`
              : "—"}
          </span>
          <span>·</span>
          <span>
            {fmt.mode === "levels" ? tx("Target: Level {level}", { level: formatLevel(currentTarget) }) : tx("Target: {level}", { level: [fmt.text(currentTarget), fmt.sub(currentTarget)].filter(Boolean).join(" · ") })}
          </span>
          <span>·</span>
          <span className={isOn ? "text-emerald-500/90" : "text-amber-500/50"}>
            {isOn ? tx("Bed On") : tx("Bed Off")}
          </span>
        </div>
      </div>

      {/* Giant Bedside Touch Targets */}
      <div className={`relative mx-auto w-full max-w-md space-y-4 pb-[calc(2rem+env(safe-area-inset-bottom))] transition-opacity duration-700 ${sleeping ? "pointer-events-none opacity-0" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSleeping(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-amber-500/30 bg-amber-950/20 text-base font-bold text-amber-300/90 transition active:scale-95"
      >
        <Moon className="h-5 w-5" />
        {tx("Good night")}
      </button>
      {hotFlash?.supported && side === own && (
        <button
          type="button"
          onClick={() => quickMode.mutate({ mode: "hot-flash-mode", action: hotFlash.active ? "deactivate" : "activate" })}
          disabled={quickMode.isPending}
          className={`flex h-14 w-full items-center justify-center gap-2 rounded-3xl border text-sm font-bold transition active:scale-95 disabled:opacity-50 ${
            hotFlash.active ? "border-sky-400/60 bg-sky-900/40 text-sky-300" : "border-sky-500/30 bg-sky-950/20 text-sky-400/90"
          }`}
        >
          <Wind className="h-5 w-5" />
          {hotFlash.active ? tx("Stop hot-flash cooling") : tx("Too hot? Hot-flash cooling")}
        </button>
      )}
      <div className="grid grid-cols-3 gap-4">
        {/* Cooler (-1) */}
        <button
          type="button"
          onClick={() => handleAdjust(-1)}
          disabled={setTargetLevelMutation.isPending}
          className="flex h-24 flex-col items-center justify-center rounded-3xl border border-sky-500/40 bg-sky-950/20 text-sky-400 active:scale-95 transition hover:bg-sky-950/40 disabled:opacity-50"
        >
          <Snowflake className="h-6 w-6" />
          <span className="mt-1.5 text-xs font-bold">Cooler (-1)</span>
        </button>

        {/* Master Power Toggle */}
        <button
          type="button"
          onClick={handleTogglePower}
          disabled={setPowerMutation.isPending}
          className={`flex h-24 flex-col items-center justify-center rounded-3xl border active:scale-95 transition disabled:opacity-50 ${
            isOn
              ? "border-rose-500/50 bg-rose-950/30 text-rose-400 hover:bg-rose-950/50"
              : "border-emerald-500/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/50"
          }`}
        >
          <Power className="h-7 w-7" />
          <span className="mt-1 text-xs font-bold">
            {setPowerMutation.isPending
              ? "..."
              : isOn
              ? tx("Turn Off")
              : tx("Turn On")}
          </span>
        </button>

        {/* Warmer (+1) */}
        <button
          type="button"
          onClick={() => handleAdjust(1)}
          disabled={setTargetLevelMutation.isPending}
          className="flex h-24 flex-col items-center justify-center rounded-3xl border border-amber-500/40 bg-amber-950/20 text-amber-400 active:scale-95 transition hover:bg-amber-950/40 disabled:opacity-50"
        >
          <Flame className="h-6 w-6" />
          <span className="mt-1.5 text-xs font-bold">Warmer (+1)</span>
        </button>
      </div>
      </div>
    </div>
  );
};

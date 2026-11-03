"use client";

import React, { useEffect, useRef, useState } from "react";
import { CloudSun, Coffee, Loader2, Plane } from "lucide-react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { Sheet } from "~/components/ui/sheet";
import { useSide } from "~/components/sideContext";
import { haptic, readStorage, writeStorage } from "~/lib/clientStorage";
import { chime } from "~/lib/sounds";
import { formatLevel } from "~/lib/presets";
import { tx, txLocale } from "~/lib/i18n";
import { formatC, useTempUnit } from "~/lib/tempUnit";

const clock = (d: Date | string) => new Date(d).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });
const minsLeft = (d: Date | string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 60_000));

/** Re-renders every 30 s, for countdowns. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const NAP_LENGTHS = [20, 45, 90];
const NAP_LEVELS = [-30, -20, -10, 0];

/** Two big buttons under the controller: "I'm hot" (20 cold minutes) and a nap with a warm wake-up. */
export const QuickActions: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const { selected } = useSide();
  const extras = apiR.fun.getExtras.useQuery(undefined, { staleTime: 60_000 });
  const [napOpen, setNapOpen] = useState(false);
  const [napLen, setNapLen] = useState(20);
  const [napLevel, setNapLevel] = useState(-20);
  useNow();

  const refresh = () =>
    Promise.all([utils.user.getPodStatus.invalidate(), utils.user.getAccount.invalidate(), utils.fun.getExtras.invalidate()]);
  const hot = apiR.fun.imHot.useMutation({
    onSuccess: async (d) => {
      haptic([20, 40, 20]);
      toast(d.level === null ? tx("Already cooling until {time}", { time: clock(d.until) }) : tx("Cooling to {level} until {time}, then back to how it was", { level: formatLevel(d.level), time: clock(d.until) }));
      await refresh();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const stopHot = apiR.fun.stopHot.useMutation({
    onSuccess: async () => {
      haptic(20);
      toast(tx("Back to how it was"));
      await refresh();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const nap = apiR.fun.startNap.useMutation({
    onSuccess: async (d) => {
      haptic(20);
      setNapOpen(false);
      toast(tx("Nap until {time}", { time: clock(d.until) }));
      await refresh();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const stopNap = apiR.fun.stopNap.useMutation({
    onSuccess: async () => {
      toast(tx("Nap stopped"));
      await refresh();
    },
    onError: (e) => toast(e.message, "error"),
  });

  const napOn = extras.data?.nap;
  const hotOn = extras.data?.hot && new Date(extras.data.hot.until).getTime() > Date.now() ? new Date(extras.data.hot.until) : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={hot.isPending || stopHot.isPending}
          onClick={() => (hotOn ? stopHot.mutate() : hot.mutate({ side: selected }))}
          className={`flex h-16 items-center justify-center gap-2 rounded-3xl border text-sm font-extrabold shadow-sm transition active:scale-95 disabled:opacity-50 ${
            hotOn
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
              : "border-slate-200/80 bg-white/90 text-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100"
          }`}
        >
          {hot.isPending || stopHot.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="text-xl">🥵</span>}
          <span className="text-left leading-tight">
            {tx("I'm hot")}
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {hotOn ? tx("Tap to stop · {n} min left", { n: minsLeft(hotOn) }) : tx("20 cold minutes")}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => (napOn ? stopNap.mutate() : setNapOpen(true))}
          disabled={stopNap.isPending}
          className={`flex h-16 items-center justify-center gap-2 rounded-3xl border text-sm font-extrabold shadow-sm transition active:scale-95 disabled:opacity-50 ${
            napOn
              ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200/80 bg-white/90 text-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100"
          }`}
        >
          <Coffee className="h-5 w-5" />
          <span className="text-left leading-tight">
            {napOn ? tx("Stop nap") : tx("Nap")}
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {napOn ? tx("{n} min left", { n: minsLeft(napOn.until) }) : tx("Warm wake-up")}
            </span>
          </span>
        </button>
      </div>

      <Sheet open={napOpen} onClose={() => setNapOpen(false)} title={tx("Nap")} icon={<Coffee className="h-5 w-5 text-indigo-500" />}>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {tx("Cools while you nap, warms to +2 for the last 5 minutes to wake you gently, then turns off.")}
        </p>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("How long")}</p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {NAP_LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setNapLen(m)}
              className={`h-12 rounded-2xl text-sm font-extrabold transition active:scale-95 ${napLen === m ? "bg-indigo-600 text-white" : "border border-slate-200 dark:border-slate-700"}`}
            >
              {m} min
            </button>
          ))}
        </div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("Temperature")}</p>
        <div className="mb-4 grid grid-cols-4 gap-2">
          {NAP_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setNapLevel(l)}
              className={`h-11 rounded-2xl font-hud text-sm font-bold transition active:scale-95 ${napLevel === l ? "bg-cyan-600 text-white" : "border border-slate-200 text-cyan-700 dark:border-slate-700 dark:text-cyan-300"}`}
            >
              {formatLevel(l)}
            </button>
          ))}
        </div>
        <p className="mb-3 text-center text-sm font-semibold">
          {tx("Wake up at {time}", { time: clock(new Date(Date.now() + napLen * 60_000)) })}
        </p>
        <button
          type="button"
          disabled={nap.isPending}
          onClick={() => nap.mutate({ minutes: napLen, level: napLevel, warmLevel: 20, side: selected })}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-extrabold text-white transition active:scale-95 disabled:opacity-50"
        >
          {nap.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {tx("Start nap")}
        </button>
      </Sheet>
    </>
  );
};

/** Tonight's weather at home, when it changes the plan (Settings → Smart features → Weather). */
export const WeatherCard: React.FC = () => {
  const extras = apiR.fun.getExtras.useQuery(undefined, { staleTime: 10 * 60_000 });
  const unit = useTempUnit();
  const w = extras.data?.weather;
  if (!w?.hot) return null;
  const c = (n: number | null) => formatC(n, unit, 0);
  return (
    <div className="flex items-start gap-3 rounded-3xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4 dark:border-orange-900/60 dark:from-orange-950/40 dark:to-amber-950/30">
      <CloudSun className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
      <div className="min-w-0 text-sm">
        <p className="font-extrabold text-orange-900 dark:text-orange-100">{tx("Hot night tonight · {temp}", { temp: c(w.evening ?? w.warmest) })}</p>
        <p className="text-xs text-orange-800/80 dark:text-orange-200/70">
          {tx("Cooling starts 30 minutes earlier and falling asleep is one step colder.")}
        </p>
      </div>
    </div>
  );
};

const TRAVEL_AWAY_KEY = "podhub-travel-away";

/**
 * With travel mode on (and location already allowed), checks once per visit whether the phone is
 * far from home: offers Away, and turns Away off again when you're back if it turned it on.
 */
export const TravelBanner: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const extras = apiR.fun.getExtras.useQuery(undefined, { staleTime: 10 * 60_000 });
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const enabled = !!extras.data?.travelEnabled && !!extras.data.hasHome;

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    let cancelled = false;
    // only when the phone already allows it: never pop a location question on open
    void (navigator.permissions?.query({ name: "geolocation" as PermissionName }) ?? Promise.resolve({ state: "prompt" }))
      .then((p) => {
        if (p.state !== "granted" || cancelled) return;
        navigator.geolocation.getCurrentPosition(
          (g) => !cancelled && setPos({ lat: g.coords.latitude, lon: g.coords.longitude }),
          () => undefined,
          { maximumAge: 30 * 60_000, timeout: 10_000 },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const check = apiR.fun.checkTravel.useQuery(pos ?? { lat: 0, lon: 0 }, { enabled: !!pos, staleTime: 30 * 60_000 });
  const vacation = apiR.user.setVacationMode.useMutation({
    onSuccess: async (_d, v) => {
      writeStorage(TRAVEL_AWAY_KEY, v.enabled ? "1" : null);
      await Promise.all([utils.user.getAccount.invalidate(), utils.fun.checkTravel.invalidate()]);
      toast(v.enabled ? tx("Away is on: the Pod rests while you're gone") : tx("Welcome home! Away is off"));
    },
    onError: (e) => toast(e.message, "error"),
  });

  // back home after the app turned Away on: turn it off by itself, once
  const autoOff = useRef(false);
  const c = check.data;
  useEffect(() => {
    if (!c || c.away || !c.vacation || autoOff.current || readStorage(TRAVEL_AWAY_KEY) !== "1") return;
    autoOff.current = true;
    vacation.mutate({ enabled: false });
  }, [c, vacation]);

  if (!c?.away || c.vacation || dismissed) return null;
  return (
    <div className="rounded-3xl border border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50 p-4 dark:border-sky-900/60 dark:from-sky-950/40 dark:to-cyan-950/30">
      <div className="flex items-start gap-3">
        <Plane className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
        <div className="min-w-0 text-sm">
          <p className="font-extrabold text-sky-900 dark:text-sky-100">{tx("Looks like you're away")}</p>
          <p className="text-xs text-sky-800/80 dark:text-sky-200/70">
            {tx("You're {km} km from home. Turn on Away so the Pod rests?", { km: (c.km ?? 0).toLocaleString(txLocale()) })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={vacation.isPending}
          onClick={() => vacation.mutate({ enabled: true })}
          className="h-10 flex-1 rounded-2xl bg-sky-600 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50"
        >
          {tx("Turn on Away")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="h-10 flex-1 rounded-2xl border border-sky-300 text-xs font-bold text-sky-800 dark:border-sky-800 dark:text-sky-200"
        >
          {tx("Not now")}
        </button>
      </div>
    </div>
  );
};

/** From 9 PM to 3 AM, a nudge toward bedtime mode. */
/** A soft chime and buzz when a side reaches the temperature it was heading to. */
export const TargetChime: React.FC = () => {
  const toast = useToast();
  const left = apiR.user.getPodStatus.useQuery({ side: "left" }, { refetchInterval: 30_000, retry: false });
  const right = apiR.user.getPodStatus.useQuery({ side: "right" }, { refetchInterval: 30_000, retry: false });
  const was = useRef<Record<string, boolean | null>>({ left: null, right: null });
  useEffect(() => {
    for (const [side, q] of [["left", left.data], ["right", right.data]] as const) {
      if (!q) continue;
      const at = q.isOn && q.targetHeatingLevel !== null && Math.round(q.heatingLevel / 10) === Math.round((q.targetHeatingLevel ?? 0) / 10);
      // only a change from "on the way" to "there" while the app is open
      if (was.current[side] === false && at) {
        chime();
        haptic([15, 60, 15]);
        toast(tx("{side} side reached {level}", { side: tx(side === "left" ? "Left" : "Right"), level: formatLevel(q.targetHeatingLevel ?? 0) }), "info");
      }
      was.current[side] = q.isOn ? at : null;
    }
  }, [left.data, right.data, toast]);
  return null;
};


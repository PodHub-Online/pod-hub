"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Award, BarChart3, CalendarDays, Clock, Crown, Download, Flame, Loader2, Share2, Sparkles } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { useSide } from "~/components/sideContext";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { formatLevel } from "~/lib/presets";
import { tx, txLocale } from "~/lib/i18n";
import { YearInSleepCard } from "~/components/newFeatures";
import { TemperatureHistory } from "~/components/tempHistory";

const tz = () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
const HOUR = 3_600_000;
const dayOf = (t: number) => new Date(t).toLocaleDateString("en-CA"); // local YYYY-MM-DD
const hm = (min: number | null) => (min === null ? "—" : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`);
const clock = (d: Date) => d.toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

/** One night: what the pod did (your side) next to what WHOOP (or Eight Sleep) measured. */
export interface Night {
  /** evening date, YYYY-MM-DD */
  night: string;
  /** average level while on, in app steps (−10…+10); null when the pod stayed off */
  level: number | null;
  /** the level the schedule set in each stage, in app steps (older nights don't have it) */
  stages: { initial: number | null; mid: number | null; final: number | null } | null;
  scheduleRan: boolean;
  manualChanges: number;
  asleepAt: Date | null;
  wokeAt: Date | null;
  sleepMin: number | null;
  deepMin: number | null;
  remMin: number | null;
  recovery: number | null;
  /** Eight Sleep's sleep score (without WHOOP) */
  score: number | null;
  hrv: number | null;
}

/** Nights joined from the pod's summaries and WHOOP (up to 60), or Eight Sleep's own sleep tracking (31) without WHOOP. */
export function useNights(days = 60) {
  const { own } = useSide();
  const timezone = useMemo(tz, []);
  const levels = apiR.fun.getNightLevels.useQuery({ days, timezone }, { staleTime: 30 * 60_000 });
  const whoopStatus = apiR.whoop.getStatus.useQuery(undefined, { retry: false, staleTime: 10 * 60_000 });
  const whoop = apiR.whoop.getNights.useQuery({ days: Math.min(days, 62) }, { enabled: !!whoopStatus.data?.connected, staleTime: 30 * 60_000 });
  // no WHOOP: use the pod's own sleep tracking (deep sleep, REM, times) instead
  const useEight = whoopStatus.isFetched && !whoopStatus.data?.connected;
  const eight = apiR.user.getSleepData.useQuery({ days: 31, timezone }, { enabled: useEight, retry: false, staleTime: 30 * 60_000 });
  const nights = useMemo(() => {
    const by = new Map<string, Night>();
    const blank = (night: string): Night => ({ night, level: null, stages: null, scheduleRan: false, manualChanges: 0, asleepAt: null, wokeAt: null, sleepMin: null, deepMin: null, remMin: null, recovery: null, score: null, hrv: null });
    for (const r of levels.data ?? []) {
      if (r.side !== own) continue;
      const st = r.stageLevels;
      const step = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 10);
      by.set(r.night, {
        ...blank(r.night),
        level: r.avgLevel === null ? null : r.avgLevel / 10,
        stages: st ? { initial: step(st.initial), mid: step(st.mid), final: step(st.final) } : null,
        scheduleRan: r.scheduleRan,
        manualChanges: r.manualChanges,
      });
    }
    for (const w of whoop.data ?? []) {
      if (w.nap) continue;
      const start = new Date(w.start);
      const night = dayOf(start.getTime() - 12 * HOUR);
      const n = by.get(night) ?? blank(night);
      const ms = (k: string) => num(get(w.sleep, `score.stage_summary.${k}`));
      const inBed = ms("total_in_bed_time_milli");
      const awake = ms("total_awake_time_milli");
      by.set(night, {
        ...n,
        asleepAt: start,
        wokeAt: new Date(w.end),
        sleepMin: inBed !== null ? (inBed - (awake ?? 0)) / 60_000 : null,
        deepMin: ms("total_slow_wave_sleep_time_milli") !== null ? ms("total_slow_wave_sleep_time_milli")! / 60_000 : null,
        remMin: ms("total_rem_sleep_time_milli") !== null ? ms("total_rem_sleep_time_milli")! / 60_000 : null,
        recovery: num(get(w.recovery, "score.recovery_score")),
        hrv: num(get(w.recovery, "score.hrv_rmssd_milli")),
      });
    }
    if (useEight) {
      for (const d of eight.data?.days ?? []) {
        if (d.processing || !d.day || !d.sleepSeconds) continue;
        // Eight Sleep keys a night by the morning it ended; ours by the evening it started
        const night = dayOf(new Date(`${d.day}T12:00:00`).getTime() - 24 * HOUR);
        const n = by.get(night) ?? blank(night);
        by.set(night, {
          ...n,
          asleepAt: d.presenceStart ? new Date(d.presenceStart) : null,
          wokeAt: d.presenceEnd ? new Date(d.presenceEnd) : null,
          sleepMin: d.sleepSeconds / 60,
          deepMin: d.deepSeconds !== null ? d.deepSeconds / 60 : null,
          remMin: d.remSeconds !== null ? d.remSeconds / 60 : null,
          hrv: d.hrv,
          score: d.score ?? null,
        });
      }
    }
    return [...by.values()].sort((a, b) => b.night.localeCompare(a.night));
  }, [levels.data, whoop.data, eight.data, useEight, own]);
  const source = useEight ? ("eight" as const) : ("whoop" as const);
  return { nights, loading: levels.isLoading || (whoopStatus.data?.connected ? whoop.isLoading : useEight && eight.isLoading), hasWhoop: !!whoopStatus.data?.connected, source, own };
}

const DISMISS = (k: string) => `podhub-dismiss-${k}`;
const dismissed = (k: string) => Number(readStorage(DISMISS(k)) ?? 0) > Date.now();
const dismissForAWeek = (k: string) => writeStorage(DISMISS(k), String(Date.now() + 7 * 24 * HOUR));

/** Saves one part of your side's schedule (keeps everything else). */
export function useProfileSave(onDone: string) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const { own } = useSide();
  const profile = apiR.user.getUserTemperatureProfile.useQuery({ side: own });
  const save = apiR.user.updateUserTemperatureProfile.useMutation({
    onSuccess: async () => {
      await utils.user.getUserTemperatureProfile.invalidate();
      toast(onDone);
    },
    onError: (e) => toast(e.message, "error"),
  });
  const apply = (change: Partial<{ initialSleepLevel: number; midStageSleepLevel: number; finalSleepLevel: number; bedTime: string }>) => {
    const p = profile.data;
    if (!p) return;
    save.mutate({
      bedTime: p.bedTime,
      wakeupTime: p.wakeupTime,
      midStageSleepLevelStartTime: p.midStageSleepLevelStartTime,
      finalSleepLevelStartTime: p.finalSleepLevelStartTime,
      initialSleepLevel: p.initialSleepLevel,
      midStageSleepLevel: p.midStageSleepLevel,
      finalSleepLevel: p.finalSleepLevel,
      wakeupAlarmEnabled: p.wakeupAlarmEnabled,
      wakeupAlarmLevel: p.wakeupAlarmLevel,
      wakeupAlarmLeadMinutes: p.wakeupAlarmLeadMinutes,
      preWakeEnabled: p.preWakeEnabled,
      preWakeLevel: p.preWakeLevel,
      preWakeLeadMinutes: p.preWakeLeadMinutes,
      preheatLeadMinutes: p.preheatLeadMinutes,
      timezoneTZ: p.timezoneTZ,
      activeDays: p.activeDays,
      side: own,
      ...change,
    });
  };
  return { profile: profile.data, apply, busy: save.isPending };
}

type Stage = "initial" | "mid" | "final";
type StageField = "initialSleepLevel" | "midStageSleepLevel" | "finalSleepLevel";

/**
 * What each stage is judged by: falling asleep → total sleep, deep sleep → deep sleep,
 * late sleep → REM (most REM comes late in the night).
 */
const STAGES: { key: Stage; field: StageField; name: string; metric: (n: Night) => number | null; what: string }[] = [
  { key: "initial", field: "initialSleepLevel", name: "Falling asleep", metric: (n) => n.sleepMin, what: "sleep" },
  { key: "mid", field: "midStageSleepLevel", name: "Deep sleep", metric: (n) => n.deepMin, what: "deep sleep" },
  { key: "final", field: "finalSleepLevel", name: "Late sleep", metric: (n) => n.remMin, what: "REM" },
];

/** A stage's level on a night: its own if saved, else the night's average for deep sleep (older nights). */
const stageLevel = (n: Night, k: Stage) => n.stages?.[k] ?? (k === "mid" ? n.level : null);

/** Levels (whole steps, at least 2 nights each) with the average of the stage's measure. */
function byLevel(nights: Night[], k: Stage, metric: (n: Night) => number | null) {
  const groups = new Map<number, number[]>();
  for (const n of nights) {
    const l = stageLevel(n, k);
    const m = metric(n);
    if (l === null || m === null) continue;
    groups.set(Math.round(l), [...(groups.get(Math.round(l)) ?? []), m]);
  }
  return [...groups.entries()]
    .filter(([, xs]) => xs.length >= 2)
    .map(([level, xs]) => ({ level, value: avg(xs)!, n: xs.length }))
    .sort((a, b) => b.level - a.level);
}

const MIN_NIGHTS = 10;

/** #1: for each stage, compares the levels you slept at with how that part of the night went, and suggests a better level. */
export const AutoTuneCard: React.FC<{ nights: Night[]; source: "whoop" | "eight" }> = ({ nights, source }) => {
  const { profile, apply, busy } = useProfileSave(tx("Schedule updated"));
  const [hidden, setHidden] = useState(() => dismissed("autotune"));
  const usable = nights.filter((n) => n.level !== null && n.deepMin !== null).length;
  if (!profile || hidden) return null;
  const rows = STAGES.map((s) => {
    const groups = byLevel(nights, s.key, s.metric);
    const current = Math.round(profile[s.field] / 10);
    const best = [...groups].sort((a, b) => b.value - a.value)[0];
    const now = groups.find((g) => g.level === current);
    const gain = best && now ? (best.value - now.value) / now.value : 0;
    const suggest = usable >= MIN_NIGHTS && !!best && !!now && best.level !== current && gain >= 0.08;
    return { ...s, groups, current, best, gain, suggest, minutes: best && now ? best.value - now.value : 0 };
  });
  const picks = rows.filter((r) => r.suggest);
  const deep = rows[1]!;
  const max = Math.max(1, ...deep.groups.map((g) => g.value));
  return (
    <Card>
      <CardHeader
        icon={<Sparkles className="h-5 w-5" />}
        title={picks.length ? tx("Suggestion for tonight") : tx("Auto-tune")}
        subtitle={
          usable < MIN_NIGHTS
            ? tx(source === "whoop" ? "Learning · {n} of {total} nights with WHOOP" : "Learning · {n} of {total} nights with sleep data", { n: usable, total: MIN_NIGHTS })
            : tx("What worked best for you · last {n} nights", { n: usable })
        }
      />
      {usable >= MIN_NIGHTS && (
        <div className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-semibold">{tx(r.name)}</span>
                <span className="block text-xs text-slate-500">
                  {r.suggest
                    ? tx("+{min} min {what} on nights at {level}", { min: Math.round(r.minutes), what: tx(r.what), level: formatLevel(r.best!.level * 10) })
                    : r.groups.length < 2
                    ? tx("needs nights at a few different levels")
                    : tx("already your best")}
                </span>
              </span>
              <b className="font-hud whitespace-nowrap">
                {r.suggest ? (
                  <>
                    <span className="text-slate-400">{formatLevel(r.current * 10)}</span> → <span className="text-sky-500">{formatLevel(r.best!.level * 10)}</span>
                  </>
                ) : (
                  formatLevel(r.current * 10)
                )}
              </b>
            </div>
          ))}
        </div>
      )}
      {deep.groups.length > 0 && (
        <>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Deep sleep by level")}</p>
          <div className="mb-3 flex h-24 items-end gap-2">
            {deep.groups.map((g) => (
              <div key={g.level} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-bold text-slate-500">{hm(g.value)}</span>
                <div
                  className={`w-full rounded-t-lg ${deep.best?.level === g.level ? "bg-cyan-500" : "bg-slate-300 dark:bg-slate-700"}`}
                  style={{ height: `${(g.value / max) * 100}%` }}
                />
                <span className={`font-hud text-[11px] ${g.level === deep.current ? "font-black" : "text-slate-500"}`}>{formatLevel(g.level * 10)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {picks.length > 0 ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => apply(Object.fromEntries(picks.map((r) => [r.field, r.best!.level * 10])))}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-xs font-extrabold text-white transition active:scale-95 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {picks.length === 1 ? tx("Use this suggestion") : tx("Use all {n} suggestions", { n: picks.length })}
          </button>
          <button
            type="button"
            onClick={() => {
              dismissForAWeek("autotune");
              setHidden(true);
            }}
            className="h-10 rounded-2xl border border-slate-200 px-4 text-xs font-bold dark:border-slate-700"
          >
            {tx("Not now")}
          </button>
        </div>
      ) : null}
    </Card>
  );
};

/** #2: if WHOOP (or Eight Sleep) sees you falling asleep later than the schedule, offers to move bedtime (and pre-cool) to match. */
export const BedtimeFollowCard: React.FC<{ nights: Night[]; source: "whoop" | "eight" }> = ({ nights, source }) => {
  const { profile, apply, busy } = useProfileSave(tx("Bedtime moved"));
  const [hidden, setHidden] = useState(() => dismissed("bedtime"));
  if (!profile || hidden) return null;
  const recent = nights.filter((n) => n.asleepAt).slice(0, 5);
  if (recent.length < 4) return null;
  const [bh = 0, bm = 0] = profile.bedTime.slice(0, 5).split(":").map(Number);
  // minutes after the scheduled bedtime (−: earlier), on the night's own evening
  const late = recent.map((n) => {
    const d = n.asleepAt!;
    const diff = d.getHours() * 60 + d.getMinutes() - (bh * 60 + bm);
    return ((diff + 720 + 1440) % 1440) - 720;
  });
  const lateNights = late.filter((m) => m >= 25).length;
  const meanLate = avg(late)!;
  if (lateNights < 4 || meanLate < 25) return null;
  const shift = Math.round((meanLate - 15) / 5) * 5;
  const newMin = (bh * 60 + bm + shift + 1440) % 1440;
  const newBed = `${String(Math.floor(newMin / 60)).padStart(2, "0")}:${String(newMin % 60).padStart(2, "0")}`;
  const asleep = new Date(2000, 0, 1, bh, bm + Math.round(meanLate));
  return (
    <Card>
      <CardHeader icon={<Clock className="h-5 w-5" />} title={tx("Bedtime follows you")} subtitle={tx(source === "whoop" ? "From WHOOP, your last {n} nights" : "From your sleep tracking, last {n} nights", { n: recent.length })} />
      <p className="mb-1 text-sm">
        {tx("Your bedtime is {bed}, but you've been falling asleep around {asleep}.", { bed: profile.bedTime.slice(0, 5), asleep: clock(asleep) })}
      </p>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {tx("Moving bedtime to {time} starts the cooling later too, so it's ready when you are.", { time: newBed })}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => apply({ bedTime: newBed })}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-xs font-extrabold text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {tx("Move bedtime to {time}", { time: newBed })}
        </button>
        <button
          type="button"
          onClick={() => {
            dismissForAWeek("bedtime");
            setHidden(true);
          }}
          className="h-10 rounded-2xl border border-slate-200 px-4 text-xs font-bold dark:border-slate-700"
        >
          {tx("Keep it")}
        </button>
      </div>
    </Card>
  );
};

/** #5: nights on schedule in a row, and small badges. */
export const StreaksCard: React.FC<{ nights: Night[] }> = ({ nights }) => {
  let streak = 0;
  for (const n of nights) {
    if (n.scheduleRan) streak++;
    else break;
  }
  const ran = nights.filter((n) => n.scheduleRan).length;
  const badges = [
    { icon: "🔥", name: "On a roll", hint: "7 nights on schedule in a row", got: streak >= 7 },
    { icon: "🌊", name: "Deep diver", hint: "2 hours of deep sleep in one night", got: nights.some((n) => (n.deepMin ?? 0) >= 120) },
    { icon: "🐦", name: "Early bird", hint: "Asleep before 23:00 three times", got: nights.filter((n) => n.asleepAt && n.asleepAt.getHours() >= 18 && n.asleepAt.getHours() < 23).length >= 3 },
    { icon: "🧊", name: "Ice cold", hint: "A whole night at −5 or colder", got: nights.some((n) => n.level !== null && n.level <= -5) },
    { icon: "💚", name: "Fully charged", hint: "90% recovery or more", got: nights.some((n) => (n.recovery ?? 0) >= 90) },
    { icon: "🏆", name: "30 nights", hint: "30 nights on schedule", got: ran >= 30 },
  ];
  return (
    <Card>
      <CardHeader icon={<Award className="h-5 w-5" />} title={tx("Streaks & badges")} subtitle={tx("{n} badges of {total}", { n: badges.filter((b) => b.got).length, total: badges.length })} />
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-orange-500/10 p-3">
        <Flame className="h-6 w-6 text-orange-500" />
        <p className="text-sm font-extrabold">
          {streak === 1 ? tx("1 night on schedule") : tx("{n} nights on schedule in a row", { n: streak })}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {badges.map((b) => (
          <div key={b.name} title={tx(b.hint)} className={`rounded-2xl border p-2 text-center ${b.got ? "border-slate-200 dark:border-slate-700" : "border-dashed border-slate-200 opacity-40 grayscale dark:border-slate-800"}`}>
            <div className="text-2xl">{b.icon}</div>
            <div className="text-[11px] font-bold leading-tight">{tx(b.name)}</div>
            <div className="text-[9px] leading-tight text-slate-500">{tx(b.hint)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

/** #6: a picture of last night to keep or share. */
export const RecapCard: React.FC<{ nights: Night[] }> = ({ nights }) => {
  const toast = useToast();
  const name = apiR.user.getAccount.useQuery(undefined, { staleTime: 10 * 60_000 }).data?.displayName;
  const last = nights.find((n) => n.sleepMin !== null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!last) return;
    const c = (canvas.current ??= document.createElement("canvas"));
    c.width = 1080;
    c.height = 1350;
    const g = c.getContext("2d");
    if (!g) return;
    const bg = g.createLinearGradient(0, 0, 0, 1350);
    bg.addColorStop(0, "#0b1222");
    bg.addColorStop(1, "#1e1b4b");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1080, 1350);
    // a few stars
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + ((i * 37) % 50) / 100})`;
      g.beginPath();
      g.arc((i * 173) % 1080, (i * 97) % 520, 1.5 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
    const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.fillStyle = "#a5b4fc";
    g.font = font(800, 40);
    g.fillText(name ? `${name.toUpperCase()}'S NIGHT` : tx("MY NIGHT"), 80, 140);
    g.fillStyle = "#94a3b8";
    g.font = font(600, 36);
    const evening = new Date(`${last.night}T12:00:00`);
    evening.setDate(evening.getDate() + 1);
    g.fillText(evening.toLocaleDateString(txLocale(), { weekday: "long", month: "short", day: "numeric" }), 80, 195);
    g.fillStyle = "#f8fafc";
    g.font = font(900, 190);
    g.fillText(hm(last.sleepMin), 70, 470);
    g.fillStyle = "#cbd5e1";
    g.font = font(600, 44);
    g.fillText(`${tx("asleep")}${last.recovery !== null ? ` · ${Math.round(last.recovery)}% ${tx("recovery")}` : ""}`, 80, 545);
    if (last.asleepAt && last.wokeAt) {
      g.fillStyle = "#64748b";
      g.font = font(700, 38);
      g.fillText(`${clock(last.asleepAt)}  →  ${clock(last.wokeAt)}`, 80, 630);
    }
    const tiles: [string, string][] = [
      [tx("Deep"), hm(last.deepMin)],
      ["REM", hm(last.remMin)],
      ["HRV", last.hrv !== null ? `${Math.round(last.hrv)} ms` : "—"],
      [tx("Pod level"), last.level !== null ? formatLevel(Math.round(last.level) * 10) : tx("off")],
    ];
    tiles.forEach(([k, v], i) => {
      const x = 80 + (i % 2) * 470;
      const y = 720 + Math.floor(i / 2) * 230;
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.beginPath();
      g.roundRect(x, y, 440, 200, 36);
      g.fill();
      g.fillStyle = "#94a3b8";
      g.font = font(700, 32);
      g.fillText(k.toUpperCase(), x + 36, y + 70);
      g.fillStyle = "#f1f5f9";
      g.font = font(900, 70);
      g.fillText(v, x + 36, y + 155);
    });
    g.fillStyle = "#475569";
    g.font = font(600, 28);
    g.fillText("Pod Hub", 80, 1290);
    setUrl(c.toDataURL("image/png"));
  }, [last, name]);

  if (!last) return null;
  const file = async () => {
    const blob = await new Promise<Blob | null>((r) => canvas.current?.toBlob(r, "image/png"));
    return blob ? new File([blob], `night-${last.night}.png`, { type: "image/png" }) : null;
  };
  const share = async () => {
    const f = await file();
    if (!f) return;
    try {
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: tx("My night") });
      else save();
    } catch {
      // closed the share sheet
    }
  };
  const save = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `night-${last.night}.png`;
    a.click();
    toast(tx("Saved"));
  };
  return (
    <Card>
      <CardHeader icon={<Share2 className="h-5 w-5" />} title={tx("Morning recap")} subtitle={tx("A picture of last night to keep or share")} />
      {url && <img src={url} alt={tx("Morning recap")} className="mx-auto mb-3 w-48 rounded-2xl shadow-lg" />}
      <div className="flex gap-2">
        <button type="button" onClick={() => void share()} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-xs font-extrabold text-white active:scale-95">
          <Share2 className="h-4 w-4" />
          {tx("Share")}
        </button>
        <button type="button" onClick={save} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-xs font-bold active:scale-95 dark:border-slate-700">
          <Download className="h-4 w-4" />
          {tx("Save")}
        </button>
      </div>
    </Card>
  );
};

/** #11: left vs right, from each side's Eight Sleep score (when the other side shares it). */
export const WhoSleptBetter: React.FC = () => {
  const timezone = useMemo(tz, []);
  const q = apiR.fun.getBothSidesSleep.useQuery({ timezone }, { retry: false, staleTime: 30 * 60_000 });
  const name = apiR.user.getAccount.useQuery(undefined, { staleTime: 10 * 60_000 }).data?.displayName;
  const d = q.data;
  if (!d?.mine.length || !d.theirs.length) return null;
  const other = d.own === "left" ? "right" : "left";
  const theirsBy = new Map(d.theirs.map((x) => [x.day, x]));
  const pairs = d.mine.filter((m) => theirsBy.has(m.day) && m.score !== null && theirsBy.get(m.day)!.score !== null);
  if (!pairs.length) return null;
  const last = pairs[pairs.length - 1]!;
  const them = theirsBy.get(last.day)!;
  let mineWins = 0;
  let theirWins = 0;
  for (const p of pairs) {
    const t = theirsBy.get(p.day)!.score!;
    if (p.score! > t) mineWins++;
    else if (t > p.score!) theirWins++;
  }
  const rows = [
    { side: d.own, who: name ?? tx("You"), score: last.score!, sleep: last.sleepSeconds, wins: mineWins },
    { side: other, who: tx("Partner"), score: them.score!, sleep: them.sleepSeconds, wins: theirWins },
  ].sort((a, b) => (a.side === "left" ? -1 : 1) - (b.side === "left" ? -1 : 1));
  const top = Math.max(...rows.map((r) => r.score));
  return (
    <Card>
      <CardHeader icon={<Crown className="h-5 w-5" />} title={tx("Who slept better?")} subtitle={tx("This morning, from each side's sleep score")} />
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.side} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
            <span className="w-16 text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx(r.side === "left" ? "Left" : "Right")}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.who}</span>
            <span className="text-xs text-slate-500">{hm(r.sleep !== null ? r.sleep / 60 : null)}</span>
            <span className="w-10 text-right text-xl font-black">{Math.round(r.score)}</span>
            <span className="w-6 text-center">{r.score === top && rows.filter((x) => x.score === top).length === 1 ? "👑" : r.score === top ? "🤝" : "😴"}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {tx("This week: {a} {an} · {b} {bn}", { a: tx(rows[0]!.side === "left" ? "Left" : "Right"), an: rows[0]!.wins, b: tx(rows[1]!.side === "left" ? "Left" : "Right"), bn: rows[1]!.wins })}
      </p>
    </Card>
  );
};

/** #18: one dot per night, level vs recovery, with your best zone shaded. */
export const TempVsSleepChart: React.FC<{ nights: Night[] }> = ({ nights }) => {
  const pts = nights.filter((n) => n.level !== null && n.recovery !== null) as (Night & { level: number; recovery: number })[];
  if (pts.length < 5) return null;
  const minL = Math.floor(Math.min(...pts.map((p) => p.level), -6));
  const maxL = Math.ceil(Math.max(...pts.map((p) => p.level), 2));
  // the best zone: the 2-step band with the highest average recovery (at least 3 nights)
  let zone: { from: number; avg: number } | null = null;
  for (let from = minL; from < maxL; from++) {
    const inside = pts.filter((p) => p.level >= from && p.level < from + 2).map((p) => p.recovery);
    const a = inside.length >= 3 ? avg(inside)! : null;
    if (a !== null && (!zone || a > zone.avg)) zone = { from, avg: a };
  }
  const W = 320;
  const H = 180;
  const x = (l: number) => 40 + ((l - minL) / (maxL - minL)) * (W - 52);
  const y = (r: number) => H - 24 - (r / 100) * (H - 40);
  return (
    <Card>
      <CardHeader icon={<BarChart3 className="h-5 w-5" />} title={tx("Temperature vs sleep")} subtitle={tx("Recovery by the level you slept at · {n} nights", { n: pts.length })} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={tx("Temperature vs sleep")}>
        {zone && (
          <>
            <rect x={x(zone.from)} y={8} width={x(zone.from + 2) - x(zone.from)} height={H - 32} rx={8} className="fill-cyan-500/15" />
            <text x={(x(zone.from) + x(zone.from + 2)) / 2} y={20} textAnchor="middle" className="fill-cyan-600 text-[10px] font-bold dark:fill-cyan-300">
              {tx("your zone")}
            </text>
          </>
        )}
        {[0, 50, 100].map((r) => (
          <g key={r}>
            <line x1={40} x2={W - 12} y1={y(r)} y2={y(r)} className="stroke-slate-200 dark:stroke-slate-800" />
            <text x={34} y={y(r) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">{r}%</text>
          </g>
        ))}
        {Array.from({ length: maxL - minL + 1 }, (_, i) => minL + i)
          .filter((l) => l % 2 === 0)
          .map((l) => (
            <text key={l} x={x(l)} y={H - 8} textAnchor="middle" className="fill-slate-400 font-hud text-[9px]">
              {formatLevel(l * 10)}
            </text>
          ))}
        {pts.map((p) => (
          <circle key={p.night} cx={x(p.level)} cy={y(p.recovery)} r={4.5} className={p.recovery >= 67 ? "fill-power-500" : p.recovery >= 34 ? "fill-amber-400" : "fill-rose-500"} opacity={0.85}>
            <title>{`${p.night}: ${formatLevel(Math.round(p.level * 10))}, ${Math.round(p.recovery)}%`}</title>
          </circle>
        ))}
      </svg>
      {zone && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tx("Best recovery between {a} and {b} ({avg}% on average).", { a: formatLevel(zone.from * 10), b: formatLevel((zone.from + 2) * 10), avg: Math.round(zone.avg) })}
        </p>
      )}
    </Card>
  );
};

/** #17: your month in sleep. */
export const MonthlyReport: React.FC<{ nights: Night[] }> = ({ nights }) => {
  const [back, setBack] = useState(0);
  const month = new Date();
  month.setDate(1);
  month.setMonth(month.getMonth() - back);
  const key = month.toISOString().slice(0, 7);
  const inMonth = nights.filter((n) => n.night.startsWith(key));
  const sleep = avg(inMonth.map((n) => n.sleepMin).filter((v): v is number => v !== null));
  const rec = avg(inMonth.map((n) => n.recovery).filter((v): v is number => v !== null));
  const onSched = inMonth.filter((n) => n.scheduleRan).length;
  const best = [...inMonth].filter((n) => n.recovery !== null).sort((a, b) => b.recovery! - a.recovery!)[0];
  const lvl = avg(inMonth.map((n) => n.level).filter((v): v is number => v !== null));
  return (
    <Card>
      <CardHeader
        icon={<CalendarDays className="h-5 w-5" />}
        title={month.toLocaleDateString(txLocale(), { month: "long", year: "numeric" })}
        subtitle={tx("Your month in sleep")}
        action={
          <div className="flex gap-1">
            <button type="button" disabled={back >= 1} onClick={() => setBack(1)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-bold disabled:opacity-30 dark:border-slate-700">‹</button>
            <button type="button" disabled={back === 0} onClick={() => setBack(0)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-bold disabled:opacity-30 dark:border-slate-700">›</button>
          </div>
        }
      />
      {!inMonth.length ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{tx("No nights saved for this month yet.")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[
              [tx("Avg sleep"), hm(sleep)],
              [tx("Recovery"), rec !== null ? `${Math.round(rec)}%` : "—"],
              [tx("On schedule"), `${onSched} / ${inMonth.length}`],
              [tx("Avg level"), lvl !== null ? formatLevel(Math.round(lvl) * 10) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{k}</div>
                <div className="mt-1 text-xl font-black">{v}</div>
              </div>
            ))}
          </div>
          {best && (
            <p className="mt-3 text-sm">
              {tx("Best night: {date}", { date: new Date(`${best.night}T12:00:00`).toLocaleDateString(txLocale(), { month: "short", day: "numeric" }) })}
              {best.level !== null && ` · ${formatLevel(Math.round(best.level) * 10)}`}
              {best.asleepAt && ` · ${tx("asleep at {time}", { time: clock(best.asleepAt) })}`}
              {` · ${Math.round(best.recovery!)}%`}
            </p>
          )}
        </>
      )}
    </Card>
  );
};

/** The Sleep tab's insights, in one place. */
export const SleepInsights: React.FC = () => {
  const { nights, loading, source } = useNights();
  if (loading) return null;
  return (
    <>
      <AutoTuneCard nights={nights} source={source} />
      <TemperatureHistory />
      <BedtimeFollowCard nights={nights} source={source} />
      <RecapCard nights={nights} />
      <WhoSleptBetter />
      <StreaksCard nights={nights} />
      <TempVsSleepChart nights={nights} />
      <MonthlyReport nights={nights} />
      <YearInSleepCard sleepByNight={new Map(nights.filter((n) => n.sleepMin !== null).map((n) => [n.night, n.sleepMin!]))} />
    </>
  );
};

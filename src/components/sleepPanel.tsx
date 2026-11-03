"use client";

import React, { useMemo, useState } from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { Activity, BedDouble, HeartPulse, Moon, Thermometer, Wind } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";
import { WhoopNights } from "~/components/whoopNights";
import { NightHistory } from "~/components/nightHistory";
import { SleepInsights } from "~/components/sleepInsights";

const detectTimezone = () =>
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

const hm = (seconds: number | null | undefined) => {
  if (!seconds) return "—";
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" }) : "—";

const round = (n: number | null, digits = 0) => (n === null ? "—" : n.toFixed(digits));

function Metric({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-black text-slate-900 dark:text-slate-200">
        {value}
        {unit && value !== "—" && <span className="ml-0.5 text-xs font-bold text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/** Sleep tab: what the bed reports first, then everything from WHOOP at the bottom. */
export const SleepPanel: React.FC = () => (
  <div className="space-y-4">
    <EightSleepNights />
    {/* what the pod really did last night: between the bed's sleep stats and WHOOP */}
    <NightHistory />
    {/* suggestions, streaks, the recap picture, reports */}
    <SleepInsights />
    <WhoopNights />
  </div>
);

const EightSleepNights: React.FC = () => {
  const timezone = useMemo(detectTimezone, []);
  const [unit, setUnit] = useState<"c" | "f">("f");
  const query = apiR.user.getSleepData.useQuery({ days: 7, timezone }, { retry: 1, staleTime: 10 * 60_000 });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const data = query.data;
  if (query.isError || !data?.available) {
    return (
      <Card>
        <CardHeader
          icon={<Moon className="h-5 w-5" />}
          title={tx("Sleep data unavailable")}
          subtitle={
            data && !data.available
              ? tx("Eight Sleep refused the request (HTTP {status}). Sleep tracking may need the subscription or be turned off in the Eight Sleep app.", { status: data.status })
              : tx("Couldn't load sleep data right now. Try again later.")
          }
        />
      </Card>
    );
  }

  const days = [...data.days].filter((d) => d.day).sort((a, b) => a.day.localeCompare(b.day));
  const nights = days.filter((d) => (d.sleepSeconds ?? 0) > 0);
  const last = nights[nights.length - 1];
  const temp = (c: number | null) => (c === null ? null : unit === "c" ? c : c * 1.8 + 32);

  const stageTotal = last ? (last.lightSeconds ?? 0) + (last.deepSeconds ?? 0) + (last.remSeconds ?? 0) : 0;
  const pct = (s: number | null) => (stageTotal ? ((s ?? 0) / stageTotal) * 100 : 0);
  const maxSleep = Math.max(1, ...days.map((d) => d.sleepSeconds ?? 0));

  return (
    <div className="space-y-4">
      {!last ? (
        <Card>
          <CardHeader icon={<Moon className="h-5 w-5" />} title={tx("No sleep recorded yet")} subtitle={tx("Nights will show here after Eight Sleep processes them.")} />
          {data.debug && (
            <details className="rounded-2xl bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <summary className="cursor-pointer font-bold">{tx("What Eight Sleep sent back")}</summary>
              <ul className="mt-2 space-y-1 font-mono">
                <li>trends days: {data.debug.trendsDays}{data.debug.trendsError ? ` (error: ${data.debug.trendsError})` : ""}</li>
                {data.debug.trendsDayKeys.length > 0 && <li className="break-words">day fields: {data.debug.trendsDayKeys.join(", ")}</li>}
                <li>sessions (intervals): {data.debug.intervals}{data.debug.intervalsError ? ` (error: ${data.debug.intervalsError})` : ""}</li>
                {data.debug.intervalKeys.length > 0 && <li className="break-words">session fields: {data.debug.intervalKeys.join(", ")}</li>}
              </ul>
              <p className="mt-2">{tx("If this stays empty after a night in bed, send a screenshot of this box so the parser can be adjusted.")}</p>
            </details>
          )}
        </Card>
      ) : (
        <Card>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {tx("Last night")} · {new Date(`${last.day}T12:00:00`).toLocaleDateString(txLocale(), { weekday: "long", month: "short", day: "numeric" })}
              </p>
              <p className="mt-1 text-3xl font-black text-slate-900 dark:text-slate-200">{hm(last.sleepSeconds)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tx("asleep")} · {hm(last.inBedSeconds)} {tx("in bed")} · {clock(last.presenceStart)} → {clock(last.presenceEnd)}
              </p>
              {last.processing && <p className="mt-1 text-[11px] font-semibold text-amber-600">{tx("Still processing…")}</p>}
            </div>
            {last.score !== null && (
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-slate-200 dark:stroke-slate-800" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="#6366f1"
                    strokeDasharray={`${(Math.min(100, last.score) / 100) * 97.4} 97.4`}
                  />
                </svg>
                <div className="text-center">
                  <div className="text-2xl font-black leading-none">{Math.round(last.score)}</div>
                  <div className="text-[9px] font-bold uppercase text-slate-400">{tx("score")}</div>
                </div>
              </div>
            )}
          </div>

          {stageTotal > 0 && (
            <div className="mb-4">
              <div className="flex h-3 overflow-hidden rounded-full">
                <span className="bg-sky-300" style={{ width: `${pct(last.lightSeconds)}%` }} />
                <span className="bg-indigo-600" style={{ width: `${pct(last.deepSeconds)}%` }} />
                <span className="bg-purple-400" style={{ width: `${pct(last.remSeconds)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-300" />{tx("Light")} {hm(last.lightSeconds)}</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-600" />{tx("Deep")} {hm(last.deepSeconds)}</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-purple-400" />REM {hm(last.remSeconds)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric icon={HeartPulse} label={tx("Heart rate")} value={round(last.heartRate)} unit="bpm" />
            <Metric icon={Activity} label="HRV" value={round(last.hrv)} unit="ms" />
            <Metric icon={Wind} label={tx("Breathing")} value={round(last.breathRate, 1)} unit="/min" />
            <Metric icon={Thermometer} label={tx("Bed temp")} value={round(temp(last.bedTempC), 1)} unit={`°${unit.toUpperCase()}`} />
            <Metric icon={Thermometer} label={tx("Room temp")} value={round(temp(last.roomTempC), 1)} unit={`°${unit.toUpperCase()}`} />
            <Metric icon={BedDouble} label={tx("Toss & turns")} value={round(last.tossAndTurns)} />
          </div>
          <button
            type="button"
            onClick={() => setUnit((u) => (u === "c" ? "f" : "c"))}
            className="mt-2 text-[11px] font-bold text-indigo-600 dark:text-indigo-400"
          >
            {tx("Show")} °{unit === "c" ? "F" : "C"}
          </button>
        </Card>
      )}

      <Card>
        <CardHeader icon={<Moon className="h-5 w-5" />} title={tx("Last 7 nights")} subtitle={tx("Bar = time asleep, number = sleep score")} />
        <div className="flex h-40 items-end gap-2">
          {days.map((d) => {
            const h = ((d.sleepSeconds ?? 0) / maxSleep) * 100;
            return (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  {d.score !== null ? Math.round(d.score) : ""}
                </span>
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-indigo-600 to-purple-400"
                  style={{ height: `${Math.max(h, d.sleepSeconds ? 4 : 0)}%` }}
                  title={`${d.day}: ${hm(d.sleepSeconds)}`}
                />
                <span className="text-[10px] font-semibold text-slate-400">
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString(txLocale(), { weekday: "narrow" })}
                </span>
              </div>
            );
          })}
        </div>
        {nights.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Average {hm(nights.reduce((a, d) => a + (d.sleepSeconds ?? 0), 0) / nights.length)} asleep
            {nights.some((d) => d.score !== null) &&
              ` · score ${Math.round(
                nights.filter((d) => d.score !== null).reduce((a, d) => a + d.score!, 0) /
                  nights.filter((d) => d.score !== null).length,
              )}`}
          </p>
        )}
      </Card>
    </div>
  );
};

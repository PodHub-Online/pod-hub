"use client";

import React, { useMemo } from "react";
import { Activity } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { useSchedule } from "~/components/useSchedule";
import { formatTemp, useTempUnit } from "~/lib/tempUnit";
import { tx, txLocale } from "~/lib/i18n";
import { WhoopLogo } from "~/components/whoopLogo";

type Rec = Record<string, unknown>;
const num = (o: unknown, ...path: string[]): number | null => {
  let v: unknown = o;
  for (const k of path)
    v = v && typeof v === "object" ? (v as Rec)[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const hm = (ms: number | null) => {
  if (ms === null) return "—";
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const clock = (d: Date | string) =>
  new Date(d).toLocaleTimeString(txLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const hhmmToMin = (t: string) => {
  const [h = 0, m = 0] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
/** signed difference in minutes around midnight: 23:10 vs 23:00 → +10, 00:20 vs 23:00 → +80 */
const diffMin = (actual: number, planned: number) =>
  ((actual - planned + 720 + 1440) % 1440) - 720;
const signed = (m: number) =>
  m === 0 ? "±0" : `${m > 0 ? "+" : "−"}${Math.abs(m)} min`;

// WHOOP's own recovery colors: green ≥ 67, yellow 34–66, red ≤ 33
const recoveryColor = (r: number) =>
  r >= 67 ? "#16a34a" : r >= 34 ? "#eab308" : "#dc2626";

const STAGES = [
  { key: "total_awake_time_milli", label: "Awake", color: "#94a3b8" },
  { key: "total_light_sleep_time_milli", label: "Light", color: "#7dd3fc" },
  { key: "total_slow_wave_sleep_time_milli", label: "Deep", color: "#4f46e5" },
  { key: "total_rem_sleep_time_milli", label: "REM", color: "#a855f7" },
] as const;

/** Sleep tab: what WHOOP measured last night, how it compares with the schedule, and the last two weeks. */
export const WhoopNights: React.FC = () => {
  const status = apiR.whoop.getStatus.useQuery(undefined, { retry: false });
  const nightsQuery = apiR.whoop.getNights.useQuery(
    { days: 14 },
    { enabled: !!status.data?.connected, refetchInterval: 5 * 60_000 },
  );
  const { profile } = useSchedule();
  const unit = useTempUnit();

  const nights = useMemo(
    () =>
      (nightsQuery.data ?? [])
        .filter((n) => !n.nap && n.sleep.score_state === "SCORED")
        .map((n) => {
          const stage = (k: string) =>
            num(n.sleep, "score", "stage_summary", k);
          return {
            ...n,
            start: new Date(n.start),
            end: new Date(n.end),
            stages: Object.fromEntries(
              STAGES.map((s) => [s.key, stage(s.key) ?? 0]),
            ) as Record<string, number>,
            asleep:
              (stage("total_light_sleep_time_milli") ?? 0) +
              (stage("total_slow_wave_sleep_time_milli") ?? 0) +
              (stage("total_rem_sleep_time_milli") ?? 0),
            performance: num(n.sleep, "score", "sleep_performance_percentage"),
            efficiency: num(n.sleep, "score", "sleep_efficiency_percentage"),
            respiratory: num(n.sleep, "score", "respiratory_rate"),
            disturbances: stage("disturbance_count"),
            cycles: stage("sleep_cycle_count"),
            recovery: num(n.recovery, "score", "recovery_score"),
            hrv: num(n.recovery, "score", "hrv_rmssd_milli"),
            rhr: num(n.recovery, "score", "resting_heart_rate"),
            spo2: num(n.recovery, "score", "spo2_percentage"),
            consistency: num(n.sleep, "score", "sleep_consistency_percentage"),
            // what WHOOP says you needed: baseline + sleep debt + recent strain + naps (naps lower it)
            needed:
              (num(n.sleep, "score", "sleep_needed", "baseline_milli") ?? 0) +
              (num(
                n.sleep,
                "score",
                "sleep_needed",
                "need_from_sleep_debt_milli",
              ) ?? 0) +
              (num(
                n.sleep,
                "score",
                "sleep_needed",
                "need_from_recent_strain_milli",
              ) ?? 0) +
              (num(
                n.sleep,
                "score",
                "sleep_needed",
                "need_from_recent_nap_milli",
              ) ?? 0),
            skinC: num(n.recovery, "score", "skin_temp_celsius"),
          };
        }),
    [nightsQuery.data],
  );

  const s = status.data;
  if (!s?.connected) return null;
  if (nightsQuery.isLoading) return <Skeleton className="h-64" />;

  const last = nights[0];
  if (!last) {
    return (
      <WhoopSection lastData={s.lastWebhookAt ?? s.lastSyncAt}>
        <Card>
          <WhoopLogo className="text-lg text-slate-900 dark:text-slate-100" />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {tx(
              "No scored night yet. It shows up here after WHOOP finishes scoring your sleep.",
            )}
          </p>
        </Card>
      </WhoopSection>
    );
  }

  const total =
    STAGES.reduce((a, st) => a + (last.stages[st.key] ?? 0), 0) || 1;
  const maxNight = Math.max(1, ...nights.map((n) => n.asleep));
  const bedDiff = profile
    ? diffMin(minutesOfDay(last.start), hhmmToMin(profile.bedTime))
    : null;
  const wakeDiff = profile
    ? diffMin(minutesOfDay(last.end), hhmmToMin(profile.wakeupTime))
    : null;

  return (
    <WhoopSection lastData={s.lastWebhookAt ?? s.lastSyncAt}>
      {/* Last night */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <WhoopLogo className="text-lg text-slate-900 dark:text-slate-100" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {last.end.toLocaleDateString(txLocale(), {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {last.recovery !== null && (
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  strokeWidth="3.5"
                  className="stroke-slate-200 dark:stroke-slate-800"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke={recoveryColor(last.recovery)}
                  strokeDasharray={`${(Math.min(100, last.recovery) / 100) * 97.4} 97.4`}
                />
              </svg>
              <div className="text-center">
                <div className="text-xl font-black leading-none">
                  {Math.round(last.recovery)}%
                </div>
                <div className="text-[9px] font-bold uppercase text-slate-400">
                  {tx("recovery")}
                </div>
              </div>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-3xl font-black text-slate-900 dark:text-slate-200">
              {hm(last.asleep)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tx("asleep")} · {clock(last.start)} → {clock(last.end)}
            </p>
            {last.performance !== null && (
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tx("Sleep performance {n}%", {
                  n: Math.round(last.performance),
                })}
              </p>
            )}
          </div>
        </div>

        {/* stages */}
        <div className="mt-4 flex h-3 overflow-hidden rounded-full">
          {STAGES.map((st) => (
            <div
              key={st.key}
              style={{
                width: `${((last.stages[st.key] ?? 0) / total) * 100}%`,
                background: st.color,
              }}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
          {STAGES.map((st) => (
            <span key={st.key} className="flex flex-col">
              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: st.color }}
                />
                {tx(st.label)}
              </span>
              <span className="font-bold">{hm(last.stages[st.key] ?? 0)}</span>
            </span>
          ))}
        </div>

        {/* body */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            [tx("HRV"), last.hrv !== null ? `${Math.round(last.hrv)} ms` : "—"],
            [
              tx("Resting HR"),
              last.rhr !== null ? `${Math.round(last.rhr)} bpm` : "—",
            ],
            [
              tx("Breathing"),
              last.respiratory !== null
                ? `${last.respiratory.toFixed(1)}/min`
                : "—",
            ],
            [
              tx("Efficiency"),
              last.efficiency !== null
                ? `${Math.round(last.efficiency)}%`
                : "—",
            ],
            [
              tx("Disturbances"),
              last.disturbances !== null ? String(last.disturbances) : "—",
            ],
            [
              tx("Skin temp"),
              last.skinC !== null
                ? formatTemp(last.skinC * 1.8 + 32, unit)
                : "—",
            ],
            [
              tx("Blood oxygen"),
              last.spo2 !== null ? `${Math.round(last.spo2)}%` : "—",
            ],
            [
              tx("Consistency"),
              last.consistency !== null
                ? `${Math.round(last.consistency)}%`
                : "—",
            ],
            [tx("Sleep needed"), last.needed > 0 ? hm(last.needed) : "—"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-800/50"
            >
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {label}
              </p>
              <p className="text-sm font-black">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* vs the schedule */}
      {profile && bedDiff !== null && wakeDiff !== null && (
        <Card>
          <CardHeader
            icon={<Activity className="h-5 w-5" />}
            title={tx("Night vs your schedule")}
            subtitle={tx(
              "What WHOOP measured against what the bed was set to do",
            )}
          />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {tx("In bed")}
              </p>
              <p className="font-black">{clock(last.start)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tx("schedule {time}", { time: profile.bedTime.slice(0, 5) })} ·{" "}
                {signed(bedDiff)}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {tx("Woke up")}
              </p>
              <p className="font-black">{clock(last.end)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tx("schedule {time}", {
                  time: profile.wakeupTime.slice(0, 5),
                })}{" "}
                · {signed(wakeDiff)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            {Math.abs(bedDiff) > 20
              ? tx(
                  "You got in bed {n} min {dir} than the schedule. The pre-cool and deep-sleep start are timed from your bedtime, so they were off by that much.",
                  {
                    n: Math.abs(bedDiff),
                    dir: bedDiff > 0 ? tx("later") : tx("earlier"),
                  },
                )
              : tx("Your bedtime matched the schedule.")}
          </p>
        </Card>
      )}

      {/* last two weeks */}
      {nights.length > 1 && (
        <Card>
          <CardHeader
            icon={<Activity className="h-5 w-5" />}
            title={tx("Last {n} nights", { n: nights.length })}
            subtitle={tx("Bars = sleep stages, dot = recovery")}
          />
          <div className="flex h-36 items-end gap-1.5">
            {[...nights].reverse().map((n) => (
              <div
                key={n.id}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                {n.recovery !== null && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: recoveryColor(n.recovery) }}
                    title={`${Math.round(n.recovery)}%`}
                  />
                )}
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-md"
                  style={{ height: `${(n.asleep / maxNight) * 100}%` }}
                >
                  {STAGES.slice(1).map((st) => (
                    <div
                      key={st.key}
                      style={{
                        height: `${((n.stages[st.key] ?? 0) / (n.asleep || 1)) * 100}%`,
                        background: st.color,
                      }}
                    />
                  ))}
                </div>
                <span className="text-[9px] text-slate-400">
                  {n.end.toLocaleDateString(txLocale(), { weekday: "narrow" })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <WhoopExtras />
    </WhoopSection>
  );
};

/** Header that makes it obvious this part comes from WHOOP, with when it last sent data. */
const WhoopSection: React.FC<{
  children: React.ReactNode;
  lastData: Date | string | null;
}> = ({ children, lastData }) => (
  <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-slate-100/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
    <div className="flex items-center justify-between px-1 pt-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {tx("Data from")}
        </span>
        <WhoopLogo className="text-xl text-slate-900 dark:text-slate-100" />
      </div>
      {lastData && (
        <span className="text-[10px] text-slate-400">
          {tx("updated {time}", {
            time: new Date(lastData).toLocaleString(txLocale(), {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </span>
      )}
    </div>
    {children}
  </section>
);

const hours = (ms: number | null) => (ms === null ? "—" : hm(ms));

/** Day strain, calories and heart rate (cycles), workouts and body numbers. */
const WhoopExtras: React.FC = () => {
  const extras = apiR.whoop.getExtras.useQuery(undefined, {
    retry: false,
    staleTime: 10 * 60_000,
  });
  const d = extras.data;
  if (extras.isLoading) return <Skeleton className="h-40" />;
  if (!d) return null;

  const cycles = (d.cycles ?? []).filter((c) => c.score_state === "SCORED");
  const today = cycles[0];
  const maxStrain = 21; // WHOOP's strain scale tops out at 21
  const kcal = (kj: number | null) =>
    kj === null ? "—" : `${Math.round(kj / 4.184)}`;

  return (
    <>
      {today && (
        <Card>
          <CardHeader
            icon={<Activity className="h-5 w-5" />}
            title={tx("Day strain")}
            subtitle={tx("How hard your body worked, 0–21")}
          />
          <div className="flex items-center gap-4">
            <p className="text-4xl font-black">
              {(num(today, "score", "strain") ?? 0).toFixed(1)}
            </p>
            <div className="grid flex-1 grid-cols-3 gap-2 text-center">
              {[
                [tx("Calories"), kcal(num(today, "score", "kilojoule"))],
                [
                  tx("Avg HR"),
                  num(today, "score", "average_heart_rate")?.toFixed(0) ?? "—",
                ],
                [
                  tx("Max HR"),
                  num(today, "score", "max_heart_rate")?.toFixed(0) ?? "—",
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl bg-slate-50 p-2 dark:bg-slate-800/50"
                >
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {label}
                  </p>
                  <p className="text-sm font-black">{value}</p>
                </div>
              ))}
            </div>
          </div>
          {cycles.length > 1 && (
            <div className="mt-4 flex h-20 items-end gap-1.5">
              {[...cycles].reverse().map((c) => (
                <div
                  key={String(c.id)}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                >
                  <div
                    className="w-full rounded-md bg-slate-400 dark:bg-slate-500"
                    style={{
                      height: `${((num(c, "score", "strain") ?? 0) / maxStrain) * 100}%`,
                    }}
                    title={(num(c, "score", "strain") ?? 0).toFixed(1)}
                  />
                  <span className="text-[9px] text-slate-400">
                    {new Date(String(c.start)).toLocaleDateString(txLocale(), {
                      weekday: "narrow",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<Activity className="h-5 w-5" />}
          title={tx("Workouts")}
          subtitle={tx("Last two weeks")}
        />
        {d.workouts === null ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tx("Workouts need one more WHOOP permission.")}{" "}
            <a href="/api/whoop/connect?extra" target="_blank" rel="noopener" className="font-bold underline">
              {tx("Allow workouts & body")} ›
            </a>
          </p>
        ) : d.workouts.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tx("No workouts recorded.")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {d.workouts.slice(0, 8).map((w) => {
              const start = new Date(String(w.start));
              const ms = new Date(String(w.end)).getTime() - start.getTime();
              return (
                <li
                  key={String(w.id)}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold capitalize">
                      {String(w.sport_name ?? tx("Activity")).replace(
                        /-/g,
                        " ",
                      )}
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      {start.toLocaleDateString(txLocale(), {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {hours(ms)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-black">
                      {(num(w, "score", "strain") ?? 0).toFixed(1)}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {kcal(num(w, "score", "kilojoule"))} kcal ·{" "}
                      {num(w, "score", "average_heart_rate")?.toFixed(0) ?? "—"}{" "}
                      bpm
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={<Activity className="h-5 w-5" />}
          title={tx("Body")}
        />
        {d.body === null ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tx("Body measurements need one more WHOOP permission.")}{" "}
            <a href="/api/whoop/connect?extra" target="_blank" rel="noopener" className="font-bold underline">
              {tx("Allow workouts & body")} ›
            </a>
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [
                tx("Height"),
                num(d.body, "height_meter") !== null
                  ? `${num(d.body, "height_meter")!.toFixed(2)} m`
                  : "—",
              ],
              [
                tx("Weight"),
                num(d.body, "weight_kilogram") !== null
                  ? `${num(d.body, "weight_kilogram")!.toFixed(1)} kg`
                  : "—",
              ],
              [tx("Max HR"), num(d.body, "max_heart_rate")?.toFixed(0) ?? "—"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl bg-slate-50 p-2 dark:bg-slate-800/50"
              >
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {label}
                </p>
                <p className="text-sm font-black">{value}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
};

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Flame, Power, Snowflake } from "lucide-react";
import { useSchedule } from "~/components/useSchedule";
import { isOff, preheatLabel, preWakeLead, type OffStage, type ScheduleValues } from "~/lib/presets";
import { useLevelFormat } from "~/lib/tempUnit";
import { formatDuration, fromMinutes, toMinutes } from "~/lib/schedule";
import { tx } from "~/lib/i18n";

export interface Segment {
  key: string;
  name: string;
  from: number; // minutes since timeline start
  to: number;
  level: number | null; // UI scale -10..10, null = off
  color: string;
}

const RAMP_MINUTES = 12; // the pod takes a while to reach a new level

function buildTimeline(v: ScheduleValues) {
  const bed = toMinutes(v.bedTime.slice(0, 5));
  const wake = toMinutes(v.wakeupTime.slice(0, 5));
  const mid = toMinutes(v.midStageSleepLevelStartTime.slice(0, 5));
  const final = toMinutes(v.finalSleepLevelStartTime.slice(0, 5));
  const lead = v.preheatLeadMinutes ?? 60;
  const on = bed - lead;
  const start = on - 30; // timeline starts 30 min before the pod turns on
  const rel = (m: number) => (((m - start) % 1440) + 1440) % 1440;

  const tOn = rel(on);
  const tBed = rel(bed);
  const tWake = rel(wake) || 1440;
  let tMid = rel(mid);
  let tFinal = rel(final);
  // mirror the cron's fallbacks for out-of-order stage times
  if (tMid <= tBed || tMid >= tWake) tMid = Math.min(tBed + 60, tWake);
  if (tFinal <= tMid || tFinal >= tWake) tFinal = Math.max(tWake - 60, tMid);
  const tAlarm = v.wakeupAlarmEnabled ? Math.max(tWake - v.wakeupAlarmLeadMinutes, tBed) : tWake;
  const tPreWake = preWakeLead(v) > 0 ? Math.min(Math.max(tWake - preWakeLead(v), tBed), tAlarm) : tAlarm;
  const end = tWake + 30;

  const L = (x: number) => x / 10;
  // a stage set to Off has no level: the bed is off for it (pre-cool follows falling asleep)
  const S = (stage: OffStage, x: number) => (isOff(v, stage) ? null : L(x));
  const segments: Segment[] = [
    { key: "off-before", name: "Off", from: 0, to: tOn, level: null, color: "#94a3b8" },
  ];
  if (lead > 0) {
    segments.push({ key: "preheat", name: preheatLabel(v.initialSleepLevel), from: tOn, to: tBed, level: S("initial", v.initialSleepLevel), color: "#06b6d4" });
  }
  // Stages, cut short by Pre-wake / the alarm window if they start earlier
  const stages: Segment[] = [
    { key: "initial", name: "In bed", from: tBed, to: tMid, level: S("initial", v.initialSleepLevel), color: "#6366f1" },
    { key: "mid", name: "Deep sleep", from: tMid, to: tFinal, level: S("mid", v.midStageSleepLevel), color: "#8b5cf6" },
    { key: "final", name: "Late sleep", from: tFinal, to: tWake, level: S("final", v.finalSleepLevel), color: "#3b82f6" },
  ];
  for (const s of stages) {
    const to = Math.min(s.to, tPreWake);
    if (to > s.from) segments.push({ ...s, to });
  }
  if (tPreWake < tAlarm) {
    segments.push({ key: "prewake", name: "Pre-wake", from: tPreWake, to: tAlarm, level: S("prewake", v.preWakeLevel ?? 10), color: "#fb923c" });
  }
  if (v.wakeupAlarmEnabled && tAlarm < tWake) {
    segments.push({ key: "alarm", name: "Wake-up warmth", from: tAlarm, to: tWake, level: L(v.wakeupAlarmLevel), color: "#f59e0b" });
  }
  segments.push({ key: "off-after", name: "Off (woke up)", from: tWake, to: end, level: null, color: "#94a3b8" });

  return { start, end, segments, rel };
}

export const TemperatureCurveGraph: React.FC = () => {
  const { savedValues } = useSchedule();
  return savedValues ? <CurveChart values={savedValues} /> : null;
};

export interface CurveTimeline {
  /** minutes since midnight where the timeline starts */
  start: number;
  /** length of the timeline in minutes */
  end: number;
  segments: Segment[];
  /** minutes since midnight → minutes since the timeline start */
  rel: (m: number) => number;
}

/**
 * The chart itself: for a schedule (Tonight's curve), or for any timeline of segments,
 * e.g. what the pod really did last night. Same drawing either way.
 */
export const CurveChart: React.FC<{
  values?: ScheduleValues;
  timeline?: CurveTimeline;
  title?: string;
  subtitle?: string;
  /** extra controls in the header (e.g. night arrows) */
  action?: React.ReactNode;
  /** show the "now" marker (only for tonight) */
  live?: boolean;
  /** shorter chart, for showing two sides one above the other */
  compact?: boolean;
  /** the schedule's clock minus the phone's, in minutes: times are drawn on the phone's clock */
  gap?: number;
  /** a line under the chart, e.g. which time zone the times are on */
  footer?: React.ReactNode;
}> = ({ values, timeline: given, title, subtitle, action, live = true, compact = false, gap = 0, footer }) => {
  const fmt = useLevelFormat();
  const [selected, setSelected] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(360);

  // Draw at the real on-screen width so text stays the same size on phone and desktop
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBoxW(Math.max(280, Math.min(900, Math.round(el.clientWidth))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const timeline = useMemo(() => given ?? buildTimeline(values!), [given, values]);

  const { start, end, segments, rel } = timeline;


  // Geometry
  const W = boxW;
  const H = compact ? 160 : 200;
  const padL = 26;
  const padR = 14;
  const top = 28;
  const bottom = H - 52; // bottom of the level area; time labels go below
  const levels = segments.filter((s) => s.level !== null).map((s) => s.level!);
  const maxL = Math.max(3, ...levels) + 1;
  const minL = Math.min(-3, ...levels) - 1;
  // Not to scale on purpose: short stretches (like the wake-up warmth) get a minimum
  // width so they're visible, and the off periods before and after the night are kept narrow
  // (a stage set to Off in the middle of the night keeps its real width).
  const edge = (s: Segment) => s.level === null && s.key.startsWith("off-");
  const activeTotal = segments.reduce((a, s) => a + (!edge(s) ? s.to - s.from : 0), 0);
  const weights = segments.map((s) => {
    const dur = s.to - s.from;
    return edge(s) ? Math.min(dur, activeTotal * 0.05) : Math.max(dur, activeTotal * 0.13);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const plotW = W - padL - padR;
  const x = (t: number) => {
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      const w = weights[i]!;
      if (t <= s.to || i === segments.length - 1) {
        const frac = s.to > s.from ? Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from))) : 0;
        return padL + ((acc + frac * w) / totalWeight) * plotW;
      }
      acc += w;
    }
    return padL + plotW;
  };
  const y = (lvl: number) => top + ((maxL - lvl) / (maxL - minL)) * (bottom - top);
  const zeroY = y(0);
  const rampW = Math.min(14, plotW * (RAMP_MINUTES / 600));

  // The pod only draws a line while it's on. Off time is shaded, not plotted.
  const active = segments.filter((s) => s.level !== null);
  const first = active[0];
  const last = active[active.length - 1];
  // one piece of line per stretch the pod is on (a stage set to Off breaks the line)
  const runs: Segment[][] = [];
  let run: Segment[] = [];
  for (const s of segments) {
    if (s.level === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(s);
  }
  if (run.length) runs.push(run);
  let d = "";
  let area = "";
  for (const r of runs) {
    const f = r[0]!;
    const l = r[r.length - 1]!;
    d += ` M ${x(f.from)} ${y(f.level!)}`;
    area += ` M ${x(f.from)} ${zeroY} L ${x(f.from)} ${y(f.level!)}`;
    let py = y(f.level!);
    for (const s of r) {
      const sy = y(s.level!);
      if (sy !== py) {
        const rx = Math.min(x(s.from) + rampW, x(s.to));
        d += ` L ${x(s.from)} ${py} L ${rx} ${sy}`;
        area += ` L ${x(s.from)} ${py} L ${rx} ${sy}`;
      }
      d += ` L ${x(s.to)} ${sy}`;
      area += ` L ${x(s.to)} ${sy}`;
      py = sy;
    }
    area += ` L ${x(l.to)} ${zeroY} Z`;
  }
  d = d.trim();
  area = area.trim();


  // the chart is drawn on the schedule's clock; the phone's "now" is moved onto it
  const tNow = nowMin !== null ? rel((((nowMin + gap) % 1440) + 1440) % 1440) : null;
  const shown = (t: number) => fromMinutes(start + t - gap);
  const showNow = live && tNow !== null && tNow <= end;
  const current = showNow ? segments.find((s) => tNow >= s.from && tNow < s.to) : null;
  // Details only when you tap a part of the curve
  const detail = segments.find((s) => s.key === selected) ?? null;

  // Time labels at each change; close ones go to a second row, and if that's taken too they're skipped
  const MIN_GAP = 38;
  // a time at every change, including where a stage set to Off starts
  const ticks = Array.from(new Set(active.map((s) => s.from).concat(segments.filter((s) => s.level === null && !edge(s) && s.from > 0).map((s) => s.from), last ? [last.to] : []))).sort((a, b) => a - b);
  const placed: { t: number; row: 0 | 1; label: boolean }[] = [];
  const lastX: [number, number] = [-Infinity, -Infinity];
  for (const t of ticks) {
    const px = x(t);
    if (px - lastX[0] >= MIN_GAP) {
      placed.push({ t, row: 0, label: true });
      lastX[0] = px;
    } else if (px - lastX[1] >= MIN_GAP) {
      placed.push({ t, row: 1, label: true });
      lastX[1] = px;
    } else {
      placed.push({ t, row: 0, label: false });
    }
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-200">{title ?? tx("Tonight's curve")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle ??
                tx("On {from} · off {to} · tap for details", { from: first ? shown(first.from) : "—", to: last ? shown(last.to) : "—" })}
            </p>
          </div>
        </div>
        {action}
        <div className="hidden items-center gap-3 text-[11px] font-semibold md:flex">
          <span className="flex items-center gap-1 text-cyan-500"><Snowflake className="h-3.5 w-3.5" />Cool</span>
          <span className="flex items-center gap-1 text-amber-500"><Flame className="h-3.5 w-3.5" />Warm</span>
          <span className="flex items-center gap-1 text-slate-400"><Power className="h-3.5 w-3.5" />Off</span>
        </div>
      </div>

      <div ref={boxRef} className="mt-3 w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full select-none" role="img" aria-label={tx("Tonight's temperature schedule")}>
        <defs>
          <pattern id="offHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" className="text-slate-200 dark:text-slate-800" />
          </pattern>
        </defs>

        {/* Off periods: hatched, labelled, no line */}
        {segments
          .filter((s) => s.level === null && s.to > s.from)
          .map((s) => (
            <g key={`off-${s.key}`} pointerEvents="none">
              <rect x={x(s.from)} y={top - 8} width={x(s.to) - x(s.from)} height={bottom - top + 8} fill="url(#offHatch)" rx={6} />
              {x(s.to) - x(s.from) > 40 && (
                <text x={(x(s.from) + x(s.to)) / 2} y={zeroY + 4} textAnchor="middle" className="fill-slate-400 text-[10px] font-bold">
                  OFF
                </text>
              )}
            </g>
          ))}

        {/* Zero line + level scale */}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="4 4" className="text-slate-300 dark:text-slate-700" />
        {[maxL - 1, 0, minL + 1].map((lvl) => (
          <text key={lvl} x={padL - 6} y={y(lvl) + 3} textAnchor="end" className="fill-slate-400 text-[10px] font-bold">
            {fmt.short(Math.round(lvl) * 10)}
          </text>
        ))}

        {/* Tap targets + selection highlight */}
        {segments.map((s) => (
          <rect
            key={`hit-${s.key}`}
            x={x(s.from)}
            y={top - 12}
            width={Math.max(2, x(s.to) - x(s.from))}
            height={bottom - top + 16}
            className={`cursor-pointer ${detail?.key === s.key ? "fill-indigo-500/10" : "fill-transparent"}`}
            onClick={() => setSelected(s.key === selected ? null : s.key)}
          />
        ))}

        <path d={area} fill="currentColor" className="text-slate-400/10" pointerEvents="none" />
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
          className="text-slate-500 dark:text-slate-300"
        />

        {/* Power on / off end caps */}
        {first && (
          <g pointerEvents="none">
            <circle cx={x(first.from)} cy={y(first.level!)} r={5} className="fill-white stroke-emerald-500 dark:fill-slate-900" strokeWidth={2.5} />
          </g>
        )}
        {last && (
          <g pointerEvents="none">
            <circle cx={x(last.to)} cy={y(last.level!)} r={8} className="fill-white stroke-slate-400 dark:fill-slate-900" strokeWidth={2} />
            <path
              d={`M ${x(last.to)} ${y(last.level!) - 4} L ${x(last.to)} ${y(last.level!) - 0.5} M ${x(last.to) - 3} ${y(last.level!) - 2.5} A 3.5 3.5 0 1 0 ${x(last.to) + 3} ${y(last.level!) - 2.5}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Level labels on held segments */}
        {active
          .filter((s) => x(s.to) - x(s.from) > 16)
          .map((s) => (
            <text
              key={`lbl-${s.key}`}
              x={(x(s.from) + x(s.to)) / 2}
              y={y(s.level!) - 9}
              textAnchor="middle"
              pointerEvents="none"
              className={`font-hud text-[12px] ${
                s.level! < 0 ? "fill-cyan-600 dark:fill-cyan-400" : s.level! > 0 ? "fill-orange-500 dark:fill-orange-400" : "fill-slate-600 dark:fill-slate-300"
              }`}
            >
              {fmt.short(Math.round(s.level! * 10))}
            </text>
          ))}
        {/* Change-point ticks with non-overlapping labels */}
        {placed.map(({ t, row, label }) => (
          <g key={`tick-${t}`} pointerEvents="none">
            <line
              x1={x(t)}
              x2={x(t)}
              y1={top - 6}
              y2={bottom + 4 + row * 14}
              stroke="currentColor"
              strokeWidth={1}
              className="text-slate-200 dark:text-slate-800"
            />
            {label && (
              <text
                x={x(t)}
                y={bottom + 16 + row * 16}
                textAnchor="middle"
                className="fill-slate-500 text-[10px] font-bold dark:fill-slate-400"
              >
                {shown(t)}
              </text>
            )}
          </g>
        ))}

        {/* Now marker */}
        {showNow && tNow !== null && (
          <g pointerEvents="none">
            <line x1={x(tNow)} x2={x(tNow)} y1={top - 12} y2={bottom} stroke="#10b981" strokeWidth={2} />
            <rect x={x(tNow) - 16} y={top - 24} width={32} height={14} rx={7} fill="#10b981" />
            <text x={x(tNow)} y={top - 14} textAnchor="middle" className="fill-white text-[9px] font-black">{tx("NOW")}</text>
          </g>
        )}
      </svg>
      </div>

      {detail && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: detail.color }} />
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 dark:text-slate-200">
                {tx(detail.name)}
                {detail === current && !selected ? ` · ${tx("now")}` : ""}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {shown(detail.from)} – {shown(detail.to)} · {formatDuration(detail.to - detail.from)}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-xl bg-white px-2.5 py-1 text-xs font-black text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100">
            {detail.level === null ? tx("Pod off") : fmt.mode === "levels" ? tx("Level {level}", { level: fmt.text(Math.round(detail.level * 10)) }) : fmt.text(Math.round(detail.level * 10))}
          </span>
        </div>
      )}
      {footer}
    </div>
  );
};

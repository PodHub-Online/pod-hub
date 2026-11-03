"use client";

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, List, Smartphone, Timer } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import {
  CurveChart,
  type CurveTimeline,
  type Segment,
} from "~/components/temperatureCurveGraph";
import { tx, txLocale } from "~/lib/i18n";
import { useSide } from "~/components/sideContext";
import { Sheet } from "~/components/ui/sheet";
import { actionText, QUIET } from "~/components/activityLog";

interface Row {
  id: number;
  ranAt: Date | string;
  action: string;
  level: number | null;
  source: string;
  side?: string | null;
  podWasOn: boolean | null;
  targetBefore: number | null;
  message?: string | null;
}

type Side = "left" | "right";
interface Point {
  t: number; // ms
  level: number | null; // UI scale -10..10, null = off
  manual: boolean;
}

const HOUR = 3_600_000;

/** A night runs 18:00 → 12:00 the next day. "Last night" is the one that ended (or is ending) today at noon. */
function nightWindow(daysBack: number) {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  end.setDate(end.getDate() - daysBack);
  const start = new Date(end.getTime() - 18 * HOUR);
  return {
    start: start.getTime(),
    end: Math.min(end.getTime(), Date.now()),
    fullEnd: end.getTime(),
  };
}

/**
 * Narrows a night to the schedule: from 1 h before bedtime to 1 h after wake-up, so manual
 * changes and tests during the evening or the next day don't clutter it.
 */
function scheduleWindow(
  night: { start: number; end: number; fullEnd: number },
  bedTime?: string,
  wakeupTime?: string,
) {
  if (!bedTime || !wakeupTime) return night;
  const at = (dayEnd: number, hhmm: string, eveningBefore: boolean) => {
    const [h = 0, m = 0] = hhmm.slice(0, 5).split(":").map(Number);
    const d = new Date(dayEnd);
    if (eveningBefore) d.setDate(d.getDate() - 1);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  // bedtimes from noon on are the evening before; after midnight, the same morning as the wake-up
  const bedHour = Number(bedTime.slice(0, 2));
  const bed = at(night.fullEnd, bedTime, bedHour >= 12);
  const wake = at(night.fullEnd, wakeupTime, false);
  const start = bed - HOUR;
  const fullEnd = Math.max(wake + HOUR, start + 2 * HOUR);
  return { start, end: Math.min(fullEnd, Date.now()), fullEnd };
}

/** What each side actually did, from the activity log: on, level changes, off; manual ones marked. */
function buildLines(rows: Row[], start: number, end: number) {
  const lines: Record<Side, Point[]> = { left: [], right: [] };
  const sorted = [...rows].sort(
    (a, b) => new Date(a.ranAt).getTime() - new Date(b.ranAt).getTime(),
  );
  for (const side of ["left", "right"] as const) {
    const mine = sorted.filter((r) => r.side === side || r.side === "both");
    // state when the night window opens: the last change before it, or what the first row saw
    let level: number | null = null;
    const before = mine.filter((r) => new Date(r.ranAt).getTime() < start);
    const changes = (r: Row) =>
      r.action === "turned_on" ||
      r.action === "set_level" ||
      r.action === "turned_off";
    const lastBefore = [...before].reverse().find(changes);
    if (lastBefore)
      level =
        lastBefore.action === "turned_off"
          ? null
          : (lastBefore.level ?? 0) / 10;
    else {
      const first = mine.find((r) => new Date(r.ranAt).getTime() >= start);
      if (first?.podWasOn) level = (first.targetBefore ?? 0) / 10;
    }
    const pts: Point[] = [{ t: start, level, manual: false }];
    for (const r of mine) {
      const t = new Date(r.ranAt).getTime();
      if (t < start || t > end || !changes(r)) continue;
      const next =
        r.action === "turned_off"
          ? null
          : r.level !== null
            ? r.level / 10
            : (level ?? 0);
      pts.push({ t, level: next, manual: r.source === "app" });
      level = next;
    }
    pts.push({ t: end, level, manual: false });
    lines[side] = pts;
  }
  return lines;
}

/**
 * Sleep tab: what the pod really did last night (or an earlier night): when each side came
 * on, every level change, and when it went off, with manual changes marked.
 */
/** Turns one side's real changes into the same segments Tonight's curve draws. */
function toTimeline(
  points: Point[],
  start: number,
  fullEnd: number,
): CurveTimeline {
  const d = new Date(start);
  const startMin = d.getHours() * 60 + d.getMinutes();
  const min = (t: number) => Math.round((t - start) / 60_000);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b.t <= a.t) continue;
    // same level as the stretch before: extend it instead of drawing another step
    const prev = segments[segments.length - 1];
    if (prev && prev.level === a.level) {
      prev.to = min(b.t);
      if (a.manual) {
        prev.name = "Changed by you";
        prev.color = "#f59e0b";
      }
      continue;
    }
    segments.push({
      key: `s${i}`,
      name: a.level === null ? "Off" : a.manual ? "Changed by you" : "Schedule",
      from: min(a.t),
      to: min(b.t),
      level: a.level,
      color: a.manual ? "#f59e0b" : "#64748b",
    });
  }
  // nothing known after "now" (or the end of the window): leave it as off
  const last = points[points.length - 1];
  if (last && last.t < fullEnd)
    segments.push({
      key: "rest",
      name: "Off",
      from: min(last.t),
      to: min(fullEnd),
      level: null,
      color: "#94a3b8",
    });
  return {
    start: startMin,
    end: min(fullEnd),
    segments,
    rel: (m: number) => (((m - startMin) % 1440) + 1440) % 1440,
  };
}

/** Who made a change, in plain words. */
function who(source: string) {
  switch (source) {
    case "app":
      return tx("You");
    case "check":
      return tx("Schedule check");
    case "auto":
      return tx("Schedule, after your change");
    default:
      return tx("Schedule");
  }
}

/** Every change that night (not the "nothing to do" checks), oldest first: time, what, who. */
function NightEvents({ rows, start, end, side }: { rows: Row[]; start: number; end: number; side: Side }) {
  const events = rows
    .filter((r) => {
      const t = new Date(r.ranAt).getTime();
      return t >= start && t <= end && (!r.side || r.side === side || r.side === "both") && !QUIET.has(r.action);
    })
    .sort((a, b) => new Date(a.ranAt).getTime() - new Date(b.ranAt).getTime());
  if (!events.length)
    return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{tx("Nothing changed this night.")}</p>;
  return (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800">
      {events.map((e) => {
        const failed = e.action === "error" || e.action.endsWith("_failed");
        return (
          <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
            <span className="w-[4.5rem] shrink-0 whitespace-nowrap pt-px font-mono text-xs text-slate-500 dark:text-slate-400">
              {new Date(e.ranAt).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className={`min-w-0 flex-1 font-semibold ${failed ? "text-rose-600 dark:text-rose-400" : ""}`}>
              {actionText({ action: e.action, level: e.level, message: e.message ?? null, source: e.source })}
            </span>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                e.source === "app"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {e.source === "app" ? <Smartphone className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
              {who(e.source)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Sleep tab: what the pod really did last night (or an earlier night), drawn exactly like
 * Tonight's curve: when your side came on, every level change, and when it went off.
 * Tap a part of the curve to see whether it was the schedule or a change you made.
 */
export const NightHistory: React.FC = () => {
  const [back, setBack] = useState(0); // 0 = last night, 1 = the night before…
  const [details, setDetails] = useState(false);
  const query = apiR.user.getCronHistory.useQuery(
    { days: 7 },
    { staleTime: 60_000 },
  );
  // only the part of the night the schedule covers: 1 h before bedtime → 1 h after wake-up
  const { own } = useSide();
  const profile = apiR.user.getUserTemperatureProfile.useQuery(
    { side: own },
    { staleTime: 5 * 60_000 },
  );
  const win = scheduleWindow(
    nightWindow(back),
    profile.data?.bedTime,
    profile.data?.wakeupTime,
  );

  const points = useMemo(
    () => buildLines((query.data ?? []) as Row[], win.start, win.end)[own],
    [query.data, win.start, win.end, own],
  );
  const timeline = useMemo(
    () => toTimeline(points, win.start, win.fullEnd),
    [points, win.start, win.fullEnd],
  );

  if (query.isLoading) return <Skeleton className="h-56" />;

  const nightName = new Date(win.start).toLocaleDateString(txLocale(), {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const title =
    back === 0
      ? tx("Last night on the pod")
      : tx("Night of {date}", { date: nightName });
  const arrows = (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={() => setDetails(true)}
        aria-label={tx("Details")}
        className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300"
      >
        <List className="h-3.5 w-3.5" />
        {tx("Details")}
      </button>
      <button
        type="button"
        onClick={() => setBack((b) => Math.min(6, b + 1))}
        disabled={back >= 6}
        aria-label={tx("Earlier night")}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 dark:border-slate-700"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setBack((b) => Math.max(0, b - 1))}
        disabled={back === 0}
        aria-label={tx("Later night")}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 dark:border-slate-700"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const sheet = (
    <Sheet open={details} onClose={() => setDetails(false)} title={title} icon={<List className="h-5 w-5 text-indigo-500" />}>
      <NightEvents rows={(query.data ?? []) as Row[]} start={win.start} end={win.end} side={own} />
    </Sheet>
  );

  if (!points.some((p) => p.level !== null)) {
    return (
      <Card>
        {sheet}
        <CardHeader
          icon={<History className="h-5 w-5" />}
          title={title}
          subtitle={tx("The pod stayed off this night.")}
          action={arrows}
        />
      </Card>
    );
  }
  return (
    <>
      {sheet}
      <CurveChart
      timeline={timeline}
      live={false}
      title={title}
      subtitle={tx("What the pod actually did · tap for details")}
      action={arrows}
    />
    </>
  );
};

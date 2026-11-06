"use client";

import React, { useMemo, useState } from "react";
import { apiR } from "~/trpc/react";
import { Skeleton } from "~/components/ui/card";
import { formatLevel } from "~/lib/presets";
import { AlertTriangle, ChevronDown, Clock, Smartphone, Timer } from "lucide-react";
import { CronUrlCheck } from "~/components/cronUrlCheck";
import { tx, txLocale } from "~/lib/i18n";
import { useSide } from "~/components/sideContext";

interface Entry {
  id: number;
  ranAt: Date;
  stage: string;
  action: string;
  level: number | null;
  message: string | null;
  source: string;
  podWasOn: boolean | null;
  levelBefore: number | null;
  targetBefore: number | null;
  durationMs: number | null;
  meta?: string | null;
  /** "left", "right" or "both"; null for things about the whole account (vacation, sign-in…) */
  side?: string | null;
  /** one cron run checks each side; those rows are shown as one line, one part per side */
  parts?: Entry[];
}

/**
 * A single cron (or check) run writes one row per side, a moment apart. Show each run as one
 * line: the rows become its parts, and the line counts as a change or error if any part does.
 */
function mergeRuns(rows: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of rows) {
    const prev = out[out.length - 1];
    const sameRun =
      prev &&
      e.source !== "app" &&
      prev.source === e.source &&
      !!e.side &&
      !!prev.side &&
      !(prev.parts ?? [prev]).some((x) => x.side === e.side) &&
      Math.abs(new Date(prev.ranAt).getTime() - new Date(e.ranAt).getTime()) < 15_000;
    if (sameRun) {
      const parts = [...(prev.parts ?? [{ ...prev }]), e].sort((a, b) => (a.side ?? "").localeCompare(b.side ?? ""));
      // the line takes the most important part's action: an error, else a change, else the first
      const lead = parts.find((x) => isError(x)) ?? parts.find((x) => !QUIET.has(x.action)) ?? parts[0]!;
      out[out.length - 1] = { ...prev, action: lead.action, stage: lead.stage, level: lead.level, side: null, parts };
      continue;
    }
    out.push(e);
  }
  return out;
}

type SideFilter = "all" | "left" | "right" | "both";
const SIDE_TAG: Record<string, string> = { left: "L", right: "R", both: "L+R" };

interface Caller {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  userAgent?: string;
  host?: string;
}

function parseCaller(meta: string | null | undefined): Caller | null {
  if (!meta) return null;
  try {
    return JSON.parse(meta) as Caller;
  } catch {
    return null;
  }
}

/** "cron-job.org" from a user agent like "Mozilla/5.0 (compatible; cron-job.org; …)" */
function callerName(ua: string | undefined) {
  if (!ua) return null;
  if (/cron-job\.org/i.test(ua)) return "cron-job.org";
  if (/vercel-cron/i.test(ua)) return "Vercel Cron";
  if (/curl\//i.test(ua)) return "curl";
  if (/Mozilla/i.test(ua)) return "a web browser";
  return ua.split(/[ /;(]/)[0] ?? null;
}

interface Group {
  newest: Entry;
  oldest: Entry;
  count: number;
}

type Filter = "all" | "cron" | "changes" | "errors" | "app";

const SOURCE_TAG: Record<string, string> = { cron: "CRON", check: "CHECK", auto: "AUTO" };

export const QUIET = new Set(["nap", "no_change", "skipped_vacation", "no_schedule", "manual_hold", "day_off", "idle", "backed_off"]);
const isError = (e: Entry) => e.action === "error" || e.action.endsWith("_failed");
const isChange = (e: Entry) => !QUIET.has(e.action) && !isError(e);

const TRIGGER: Record<string, string> = {
  cron: "Cron job (the URL was called)",
  check: "You pressed Run schedule check",
  auto: "Automatic check after you changed something",
  app: "You, in the app",
};
const lv = (l: number | null) => (l === null ? "—" : formatLevel(l));
const time = (d: Date) => new Date(d).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });

export function stageName(e: Pick<Entry, "stage" | "level">) {
  switch (e.stage) {
    case "preheat":
      return e.level !== null && e.level > 0 ? tx("Pre-heat") : tx("Pre-cool");
    case "initial":
      return tx("In bed");
    case "mid":
      return tx("Deep sleep");
    case "final":
      return tx("Late sleep");
    case "prewake":
      return tx("Pre-wake");
    case "alarm":
      return tx("Wake-up warmth");
    case "vacation":
      return tx("Vacation");
    case "manual":
      return tx("You, in the app");
    default:
      return tx("Outside schedule");
  }
}

export function actionText(e: Pick<Entry, "action" | "level" | "message"> & { source?: string }) {
  switch (e.action) {
    case "turned_on":
      return e.level !== null ? tx("Turned pod on at {level}", { level: lv(e.level) }) : tx("Turned pod on");
    case "set_level":
      return tx("Changed level to {level}", { level: lv(e.level) });
    case "turned_off":
      return tx("Turned pod off");
    case "no_change":
      return e.level !== null ? tx("Already at {level}, nothing to do", { level: lv(e.level) }) : tx("Pod already off, nothing to do");
    case "no_schedule":
      return tx("No schedule saved, nothing to do");
    case "skipped_vacation":
      return tx("Skipped: vacation mode");
    case "vacation_ended":
      return tx("Vacation ended, schedule resumed");
    case "vacation_on":
      return tx("Vacation mode on") + (e.message ? ` (${e.message})` : "");
    case "vacation_off":
      return tx("Vacation mode off");
    case "timezone_set":
      return tx("Schedules now run on {zone} time", { zone: ((e.message ?? "").split("/").pop() ?? "").replace(/_/g, " ") });
    case "schedule_saved":
      return tx("Saved the schedule");
    case "weekend_on":
      return tx("Turned on weekend nights");
    case "weekend_off":
      return tx("Turned off weekend nights");
    case "schedule_cleared":
      return tx("Cleared the schedule");
    case "preset_applied":
      return tx("Switched to preset \"{name}\"", { name: e.message ?? "" });
    case "priming_started":
      return tx("Started priming");
    case "guest_on":
      return tx("Turned the guest side on");
    case "guest_off":
      return tx("Turned the guest side off");
    case "guest_set_level":
      return tx("Set the guest side to {level}", { level: lv(e.level) }) + (e.message ? ` (${e.message})` : "");
    case "schedule_on":
      return tx("Follow schedule: on");
    case "schedule_off":
      return e.source === "app" ? tx("Follow schedule: off") : tx("Skipped: schedule is switched off");
    case "manual_hold":
      return e.message ? tx("Skipped: manual hold until {time}", { time: time(new Date(e.message)) }) : tx("Skipped: manual hold");
    case "hold_started":
      return e.message ? tx("Manual change: schedule paused until {time}", { time: time(new Date(e.message)) }) : tx("Manual change: schedule paused");
    case "hold_ended":
      return tx("Schedule resumed");
    case "day_off": {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => tx(d));
      const n = Number(e.message);
      return Number.isInteger(n) && names[n] ? tx("Skipped: {day} night is switched off", { day: names[n] }) : tx("Skipped: tonight is switched off");
    }
    case "eight_away_on":
      return tx("Eight Sleep Away mode turned on");
    case "eight_away_off":
      return tx("Eight Sleep Away mode turned off");
    case "whole_bed_on":
      return tx("Whole bed mode on (both sides together)");
    case "whole_bed_off":
      return tx("Whole bed mode off (back to your side)");
    case "preset_created":
      return tx("Saved new preset \"{name}\"", { name: e.message ?? "" });
    case "preset_updated":
      return tx("Updated preset") + (e.message ? ` "${e.message}"` : "");
    case "preset_deleted":
      return tx("Deleted preset") + (e.message ? ` "${e.message}"` : "");
    case "signed_in":
      return tx("Signed in");
    case "idle":
      return tx("Outside schedule hours, Eight Sleep not asked");
    case "im_hot":
      return tx("I'm hot: cooled to {level} for 20 minutes", { level: lv(e.level) });
    case "hot_ended":
      return tx("I'm hot over: the bed is back to how it was");
    case "nap_started":
      return tx("Nap started at {level} ({min} min)", { level: lv(e.level), min: e.message ?? "" });
    case "nap":
      return e.message === "warming" ? tx("Nap: warming you up") : tx("Nap in progress");
    case "nap_ended":
      return tx("Nap over, turned off");
    case "backed_off":
      return e.message
        ? tx("Skipped: Eight Sleep refused earlier, trying again at {time}", { time: time(new Date(e.message)) })
        : tx("Skipped: Eight Sleep refused earlier");
    case "skipped_whole_bed":
      return tx("Skipped: the whole-bed schedule is in use");
    case "other_account_restored":
      return tx("Put the other account back on its side");
    case "other_account_restore_failed":
      return tx("Couldn't put the other account back") + (e.message ? ` (${e.message})` : "");
    case "whoop_connected":
      return tx("WHOOP connected");
    case "whoop_disconnected":
      return tx("WHOOP disconnected");
    case "whoop_connect_failed":
      return tx("WHOOP didn't connect") + (e.message ? ` (${e.message})` : "");
    case "signed_out":
      return tx("Signed out");
    case "led_set":
      return `${tx("LED brightness")} ${e.message ?? ""}`;
    case "error":
      return tx("Failed: {error}", { error: e.message ?? tx("unknown error") });
    default:
      if (e.action.endsWith("_failed")) {
        const what = e.action.replace(/_failed$/, "").replace(/_/g, " ");
        return tx("Failed to change {what}: {error}", { what, error: e.message ?? tx("unknown error") });
      }
      return e.action.replace(/_/g, " ");
  }
}

function minutes(n: number) {
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${warn ? "bg-amber-50 dark:bg-amber-950/40" : "bg-slate-50 dark:bg-slate-800/50"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-black ${warn ? "text-amber-700 dark:text-amber-300" : ""}`}>{value}</div>
    </div>
  );
}

function EntryDetails({ e }: { e: Entry }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-3 text-[11px] dark:bg-slate-800/50">
      <dt className="text-slate-400">{tx("When")}</dt>
      <dd className="font-semibold">{new Date(e.ranAt).toLocaleString(txLocale())}</dd>
      <dt className="text-slate-400">{tx("Triggered by")}</dt>
      <dd className="font-semibold">{TRIGGER[e.source] ? tx(TRIGGER[e.source]!) : e.source}</dd>
      {e.source !== "app" && (
        <>
          <dt className="text-slate-400">{tx("Schedule stage")}</dt>
          <dd className="font-semibold">{stageName(e)}</dd>
          <dt className="text-slate-400">{tx("Pod before")}</dt>
          <dd className="font-semibold">
            {e.podWasOn === null ? "—" : e.podWasOn ? tx("On · at {level} → target {target}", { level: lv(e.levelBefore), target: lv(e.targetBefore) }) : tx("Off")}
          </dd>
          <dt className="text-slate-400">{tx("Schedule wanted")}</dt>
          <dd className="font-semibold">{e.level === null ? tx("Off") : lv(e.level)}</dd>
        </>
      )}
      {(() => {
        const c = parseCaller(e.meta);
        if (!c) return null;
        const place = [c.city, c.region, c.country].filter(Boolean).join(", ");
        return (
          <>
            {callerName(c.userAgent) && (
              <>
                <dt className="text-slate-400">{tx("Called by")}</dt>
                <dd className="font-semibold">{callerName(c.userAgent)}</dd>
              </>
            )}
            {c.ip && (
              <>
                <dt className="text-slate-400">{tx("IP address")}</dt>
                <dd className="break-all font-mono">{c.ip}</dd>
              </>
            )}
            {place && (
              <>
                <dt className="text-slate-400">{tx("From")}</dt>
                <dd className="font-semibold">{place}</dd>
              </>
            )}
            {c.host && (
              <>
                <dt className="text-slate-400">{tx("Address called")}</dt>
                <dd className="break-all font-mono">{c.host}</dd>
              </>
            )}
            {c.userAgent && (
              <>
                <dt className="text-slate-400">{tx("User agent")}</dt>
                <dd className="break-all font-mono text-[10px]">{c.userAgent}</dd>
              </>
            )}
          </>
        );
      })()}
      {e.durationMs !== null && (
        <>
          <dt className="text-slate-400">{tx("Took")}</dt>
          <dd className="font-semibold">{(e.durationMs / 1000).toFixed(1)} s</dd>
        </>
      )}
      {e.message && isError(e) && (
        <>
          <dt className="text-slate-400">{tx("Error")}</dt>
          <dd className="break-words font-mono text-rose-600 dark:text-rose-400">{e.message}</dd>
        </>
      )}
    </dl>
  );
}

/** What the log table holds for this account: answers "why isn't X showing up?" */
function LogDiagnostics() {
  const [open, setOpen] = useState(false);
  const q = apiR.user.getLogDiagnostics.useQuery(undefined, { enabled: open, retry: false });
  const d = q.data;
  return (
    <details
      className="rounded-2xl bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
      onToggle={(ev) => setOpen((ev.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-bold">Diagnostics</summary>
      {q.isLoading && <p className="mt-2">Checking…</p>}
      {q.isError && <p className="mt-2 text-rose-600">{q.error.message}</p>}
      {d && (
        <ul className="mt-2 space-y-1 font-mono">
          <li>signed in as: {d.signedInAs}</li>
          <li>account found: {String(d.accountFound)} · schedule saved: {String(d.hasSchedule)}</li>
          <li>last cron run: {d.lastCronRunAt ? new Date(d.lastCronRunAt).toLocaleString() : "never"}</li>
          <li>
            latest log entry: {d.latestEntry ? `${new Date(d.latestEntry.ranAt).toLocaleString()} (${d.latestEntry.source}/${d.latestEntry.action})` : "none"}
          </li>
          <li>rows: {d.rowsBySource.length ? d.rowsBySource.map((r) => `${r.who}/${r.source}=${r.rows}`).join(", ") : "table is empty"}</li>
          <li>server time: {d.serverTime} · db time: {d.dbTime}</li>
        </ul>
      )}
    </details>
  );
}

/** Everything the cron job and you did to the pod, with gaps and errors called out. */
export const ActivityLog: React.FC = () => {
  const [days, setDays] = useState(3);
  const [filter, setFilter] = useState<Filter>("all");
  // starts on the side picked on the top bar
  const { selected } = useSide();
  const [sideFilter, setSideFilter] = useState<SideFilter>(selected);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [openEntry, setOpenEntry] = useState<number | null>(null);
  const query = apiR.user.getCronHistory.useQuery({ days }, { refetchInterval: 30_000, refetchOnMount: "always" });
  // the cron job's address check is for the owner, who runs the cron job
  const owner = apiR.user.getAccount.useQuery().data?.isOwner === true;

  const view = useMemo(() => {
    const all = mergeRuns((query.data ?? []) as Entry[]);
    // Only real cron URL calls count for timing stats
    const cron = all.filter((e) => e.source === "cron");

    // Gaps between cron runs reveal how often it really runs and when it was missed
    const gaps: { min: number; at: Date }[] = [];
    for (let i = 1; i < cron.length; i++) {
      gaps.push({
        min: (new Date(cron[i - 1]!.ranAt).getTime() - new Date(cron[i]!.ranAt).getTime()) / 60000,
        at: cron[i]!.ranAt,
      });
    }
    const sorted = [...gaps].map((g) => g.min).sort((a, b) => a - b);
    const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
    const longest = gaps.reduce<{ min: number; at: Date } | null>((a, g) => (!a || g.min > a.min ? g : a), null);
    const lastRun = cron[0]?.ranAt ?? null;
    const avgMs = cron.filter((e) => e.durationMs !== null);
    const avgDuration = avgMs.length ? avgMs.reduce((a, e) => a + e.durationMs!, 0) / avgMs.length : null;

    const shown = all.filter((e) =>
      // entries without a side (vacation, sign-in, cron checks for the account) show everywhere
      (sideFilter === "all" || (!e.side && !e.parts) || e.side === sideFilter || !!e.parts?.some((x) => x.side === sideFilter)) &&
      (filter === "all"
        ? true
        : filter === "cron"
        ? e.source === "cron"
        : filter === "changes"
        ? isChange(e)
        : filter === "errors"
        ? isError(e)
        : e.source === "app"),
    );

    const byDay = new Map<string, Group[]>();
    for (const e of shown) {
      const key = new Date(e.ranAt).toDateString();
      const groups = byDay.get(key) ?? [];
      const prev = groups[groups.length - 1];
      if (
        prev &&
        filter !== "cron" &&
        QUIET.has(e.action) &&
        prev.oldest.action === e.action &&
        prev.oldest.stage === e.stage &&
        prev.oldest.level === e.level
      ) {
        prev.oldest = e;
        prev.count++;
      } else {
        groups.push({ newest: e, oldest: e, count: 1 });
      }
      byDay.set(key, groups);
    }

    return {
      groups: [...byDay.entries()],
      stats: {
        runs: cron.length,
        changes: all.filter(isChange).length,
        errors: all.filter(isError).length,
        typical,
        longest,
        lastRun,
        avgDuration,
      },
    };
  }, [query.data, filter, sideFilter]);

  const { stats } = view;
  const slow = stats.typical !== null && stats.typical > 10.5;
  const lastRunAgo = stats.lastRun ? (Date.now() - new Date(stats.lastRun).getTime()) / 60000 : null;
  const stale = lastRunAgo !== null && stats.typical !== null && lastRunAgo > Math.max(15, stats.typical * 2.5);

  return (
    <div className="space-y-3">
      {/* Range + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          {[1, 3, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`h-8 rounded-xl px-3 text-xs font-bold ${days === d ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
            >
              {d === 1 ? "24 h" : `${d} days`}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              ["all", "All sides"],
              ["left", "Left"],
              ["right", "Right"],
              ["both", "Both"],
            ] as [SideFilter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setSideFilter(f)}
              className={`h-8 rounded-xl px-3 text-xs font-bold ${sideFilter === f ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
            >
              {tx(label)}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              ["all", "All"],
              ["cron", "Cron"],
              ["changes", "Changes"],
              ["errors", "Errors"],
              ["app", "By you"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`h-8 rounded-xl px-3 text-xs font-bold ${filter === f ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
            >
              {tx(label)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      {query.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={tx("Last cron run")}
            value={lastRunAgo === null ? tx("Never") : lastRunAgo < 1 ? tx("Just now") : tx("{time} ago", { time: minutes(lastRunAgo) })}
            warn={stale}
          />
          <Stat label={tx("Runs every")} value={stats.typical === null ? "—" : `~${minutes(stats.typical)}`} warn={slow} />
          <Stat label={tx("Changes / errors")} value={`${stats.changes} / ${stats.errors}`} warn={stats.errors > 0} />
          <Stat
            label={tx("Longest gap")}
            value={stats.longest ? minutes(stats.longest.min) : "—"}
            warn={!!stats.longest && stats.typical !== null && stats.longest.min > stats.typical * 3 && stats.longest.min > 15}
          />
        </div>
      )}

      {owner && <CronUrlCheck />}

      {(slow || stale) && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {stale
              ? tx("No cron run for {time}. Check that your cron-job.org job is enabled and returning 200 OK.", { time: minutes(lastRunAgo) })
              : tx("Runs are ~{time} apart, so changes can start that late and a short wake-up window can be missed. Set the cron job to every 5 minutes.", { time: minutes(stats.typical!) })}
          </span>
        </div>
      )}
      {stats.longest && stats.typical !== null && stats.longest.min > stats.typical * 3 && stats.longest.min > 15 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {tx("Longest gap ended {when}. Runs were missed before that.", { when: new Date(stats.longest.at).toLocaleString(txLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}
        </p>
      )}

      {query.isError && (
        <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <strong>{tx("Couldn't load the activity log:")}</strong> {query.error.message}
        </div>
      )}

      {/* Entries */}
      {!query.isLoading && !query.isError && view.groups.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          {tx("Nothing here yet for this filter.")}
        </p>
      ) : (
        view.groups.map(([day, groups], idx) => {
          const open = openDays[day] ?? idx === 0;
          return (
            <div key={day} className="rounded-2xl border border-slate-200/80 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setOpenDays((o) => ({ ...o, [day]: !open }))}
                className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left"
              >
                <span className="text-sm font-extrabold">
                  {new Date(day).toLocaleDateString(txLocale(), { weekday: "long", month: "short", day: "numeric" })}
                </span>
                <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {groups.reduce((a, g) => a + g.count, 0)} events
                  <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                </span>
              </button>
              {open && (
                <ol className="border-t border-slate-200/80 px-3 py-1 dark:border-slate-800">
                  {groups.map((g) => {
                    const e = g.newest;
                    const failed = isError(e);
                    const quiet = QUIET.has(e.action);
                    const expanded = openEntry === e.id;
                    return (
                      <li key={e.id} className="py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenEntry(expanded ? null : e.id)}
                          className="flex w-full gap-3 text-left text-xs"
                        >
                          <span className="w-[5.5rem] shrink-0 font-mono text-slate-500 dark:text-slate-400">
                            {g.count > 1 ? `${time(g.oldest.ranAt)}–${time(e.ranAt)}` : time(e.ranAt)}
                          </span>
                          <span
                            className={`min-w-0 flex-1 ${
                              failed
                                ? "font-semibold text-rose-600 dark:text-rose-400"
                                : quiet
                                ? "text-slate-500 dark:text-slate-400"
                                : "font-bold text-slate-900 dark:text-slate-200"
                            }`}
                          >
                            <span className="mr-1 inline-flex align-middle">
                              {e.source === "app" ? (
                                <Smartphone className="h-3.5 w-3.5 text-indigo-500" />
                              ) : e.source === "check" || e.source === "auto" ? (
                                <Timer className="h-3.5 w-3.5 text-indigo-500" />
                              ) : quiet ? (
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <Timer className="h-3.5 w-3.5 text-emerald-500" />
                              )}
                            </span>
                            {e.side && SIDE_TAG[e.side] && (
                              <span className="mr-1 rounded bg-slate-200 px-1 py-px font-hud text-[9px] tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {SIDE_TAG[e.side]}
                              </span>
                            )}
                            {SOURCE_TAG[e.source] && (
                              <span className="mr-1 rounded bg-slate-200 px-1 py-px font-hud text-[9px] tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {SOURCE_TAG[e.source]}
                              </span>
                            )}
                            {e.parts ? (
                              e.parts.map((x, i) => (
                                <span key={x.id}>
                                  {i > 0 && <span className="text-slate-300 dark:text-slate-600"> · </span>}
                                  <span className="mr-1 rounded bg-slate-200 px-1 py-px font-hud text-[9px] tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                    {SIDE_TAG[x.side ?? ""] ?? x.side}
                                  </span>
                                  <span className="text-slate-400">{stageName(x)} · </span>
                                  <span className="break-words">{actionText(x)}</span>
                                </span>
                              ))
                            ) : (
                              <>
                                {e.source !== "app" && <span className="text-slate-400">{stageName(e)} · </span>}
                                <span className="break-words">{actionText(e)}</span>
                              </>
                            )}
                            {g.count > 1 && <span className="text-slate-400"> · {g.count} runs</span>}
                          </span>
                        </button>
                        {expanded &&
                          (e.parts ? (
                            e.parts.map((x) => (
                              <div key={x.id}>
                                <p className="mt-2 px-3 font-hud text-[10px] uppercase tracking-wider text-slate-400">
                                  {tx(x.side === "right" ? "Right" : x.side === "both" ? "Whole bed" : "Left")}
                                </p>
                                <EntryDetails e={x} />
                              </div>
                            ))
                          ) : (
                            <EntryDetails e={e} />
                          ))}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })
      )}
      {owner && <LogDiagnostics />}

      {stats.avgDuration !== null && (
        <p className="text-center text-[11px] text-slate-400">
          Average cron run takes {(stats.avgDuration / 1000).toFixed(1)} s · tap any line for details
        </p>
      )}
    </div>
  );
};

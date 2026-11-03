"use client";

import React from "react";
import TimezoneSelect, { allTimezones } from "react-timezone-select";
import { Globe2, Loader2, TriangleAlert } from "lucide-react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { Card, CardHeader } from "~/components/ui/card";
import { haptic } from "~/lib/clientStorage";
import { tx } from "~/lib/i18n";
import { deviceZone, gapMinutes, gapText, isValidZone, zoneLabel } from "~/lib/scheduleTime";

const SIDES = ["left", "right", "both"] as const;
const SIDE_NAME = { left: "Left", right: "Right", both: "Whole bed" } as const;

/** "1 hour", "2 hours", "1 h 30 min" */
export function gapWords(gap: number) {
  const { hours, minutes } = gapText(gap);
  if (minutes === 0) return hours === 1 ? tx("1 hour") : tx("{n} hours", { n: hours });
  return hours === 0 ? tx("{n} min", { n: minutes }) : tx("{h} h {m} min", { h: hours, m: minutes });
}

/** "New York" for a zone; empty when there is none */
export const zoneCity = (tz: string | null | undefined) => (isValidZone(tz) ? zoneLabel(tz).city : "");

/**
 * The time zone the account's schedules run on, how it compares to this phone, and the one-tap fix.
 * All schedules share one zone (set once in Settings); older accounts could have sides on different ones.
 */
export function useScheduleZone() {
  const toast = useToast();
  const utils = apiR.useUtils();
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const device = deviceZone();
  const zones = SIDES.map((s) => ({ side: s, tz: account.data?.sides[s].timezone ?? null })).filter((z) => isValidZone(z.tz));
  const first = zones[0]?.tz ?? null;
  const now = new Date();
  const gap = first ? gapMinutes(first, device, now) : 0;
  const mixed = new Set(zones.map((z) => z.tz)).size > 1;
  const set = apiR.user.setScheduleTimezone.useMutation({
    onSuccess: async (d) => {
      haptic(20);
      await Promise.all([utils.user.getAccount.invalidate(), utils.user.getUserTemperatureProfile.invalidate(), utils.user.getPodStatus.invalidate()]);
      toast(tx("Schedules now run on {zone} time", { zone: zoneCity(d.timezone) }));
    },
    onError: (e) => toast(e.message, "error"),
  });
  return {
    loaded: !!account.data,
    device,
    zone: first,
    zones,
    gap,
    /** the schedule's clock is not the phone's (by the clock, so same-offset zones don't count) */
    mismatch: !!first && (gap !== 0 || mixed),
    mixed,
    set,
  };
}

/** Small warning with the one-tap fix; renders nothing when the schedule clock matches the phone. */
export const ScheduleZoneBanner: React.FC<{ className?: string }> = ({ className = "" }) => {
  const z = useScheduleZone();
  if (!z.loaded || !z.mismatch || !z.zone) return null;
  const behind = z.gap < 0;
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-extrabold">
          {z.gap === 0
            ? tx("Your sides use different time zones")
            : tx("Your schedule runs on {zone} time, {gap} {dir} your phone", { zone: zoneCity(z.zone), gap: gapWords(z.gap), dir: behind ? tx("behind") : tx("ahead of") })}
        </p>
        <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{tx("Times below are shown on your phone's clock. To run the schedule on your phone's time instead, change it here.")}</p>
        <button
          type="button"
          disabled={z.set.isPending}
          onClick={() => z.set.mutate({ timezone: z.device })}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
        >
          {z.set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {tx("Use my phone's time ({zone})", { zone: zoneCity(z.device) })}
        </button>
      </div>
    </div>
  );
};

/** Schedule tab / Home: one quiet line saying which clock the times are on. */
export const ScheduleZoneNote: React.FC<{ className?: string }> = ({ className = "" }) => {
  const z = useScheduleZone();
  if (!z.loaded || !z.zone) return null;
  const { city, abbrev } = zoneLabel(z.zone);
  return (
    <p className={`flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 ${className}`}>
      <Globe2 className="h-3.5 w-3.5 shrink-0" />
      {z.mismatch && z.gap !== 0
        ? tx("Schedule runs on {city} time ({abbrev}) · {gap} {dir} your phone", { city, abbrev, gap: gapWords(z.gap), dir: z.gap < 0 ? tx("behind") : tx("ahead of") })
        : tx("Times are on {city} time ({abbrev})", { city, abbrev })}
    </p>
  );
};

/** Settings → Preferences: the one time zone all schedules run on. */
export const ScheduleTimezoneCard: React.FC = () => {
  const z = useScheduleZone();
  const [picking, setPicking] = React.useState(false);
  const label = z.zone ? zoneLabel(z.zone) : null;
  return (
    <Card>
      <CardHeader icon={<Globe2 className="h-5 w-5" />} title={tx("Schedule time zone")} subtitle={tx("Every schedule's times are on this clock")} />
      {!z.zone ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{tx("You haven't saved a schedule yet. The first one uses your phone's time zone ({zone}).", { zone: zoneCity(z.device) })}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-extrabold text-slate-900 dark:text-slate-200">
              {label!.city} <span className="font-semibold text-slate-500">({label!.abbrev})</span>
            </span>
            <button type="button" onClick={() => setPicking((v) => !v)} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">
              {picking ? tx("Close") : tx("Change")}
            </button>
          </div>
          <p className={`mt-1 text-xs ${z.mismatch ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {!z.mismatch
              ? tx("✓ Same as your phone")
              : z.gap === 0
              ? tx("Your sides use different time zones")
              : tx("{gap} {dir} your phone ({zone})", { gap: gapWords(z.gap), dir: z.gap < 0 ? tx("behind") : tx("ahead of"), zone: zoneCity(z.device) })}
          </p>
          {z.mixed && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {z.zones.map((s) => (
                <li key={s.side} className="flex justify-between gap-2">
                  <span>{tx(SIDE_NAME[s.side])}</span>
                  <span className="font-bold">{zoneCity(s.tz)}</span>
                </li>
              ))}
            </ul>
          )}
          {z.mismatch && (
            <button
              type="button"
              disabled={z.set.isPending}
              onClick={() => z.set.mutate({ timezone: z.device })}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-50"
            >
              {z.set.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {tx("Use my phone's time ({zone})", { zone: zoneCity(z.device) })}
            </button>
          )}
          {picking && (
            <div className="mt-3">
              <TimezoneSelect
                value={z.zone}
                onChange={(v) => {
                  setPicking(false);
                  const value = typeof v === "string" ? v : v.value;
                  if (value && value !== z.zone) z.set.mutate({ timezone: value });
                }}
                timezones={{ ...allTimezones, "America/New_York": "America/New York", "America/Los_Angeles": "America/Los Angeles" }}
                className="timezone-selector text-sm"
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
};

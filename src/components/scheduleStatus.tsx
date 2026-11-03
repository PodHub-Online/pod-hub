"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { haptic } from "~/lib/clientStorage";
import { CalendarCheck, CalendarOff, Hand, Loader2 } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";
import { useSide } from "~/components/sideContext";
import { ScheduleStatusLine } from "~/components/scheduleWhyUi";

/** The one label for the switch on every side (change it here, in one place). */
export const inUseLabel = (on: boolean) => (on ? tx("In use tonight") : tx("Use tonight"));

const clock = (d: Date | string) => new Date(d).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });

function useScheduleActions() {
  const toast = useToast();
  const utils = apiR.useUtils();
  const refresh = () =>
    Promise.all([utils.user.getAccount.invalidate(), utils.user.getPodStatus.invalidate(), utils.user.getPodHealth.invalidate()]);
  const setEnabled = apiR.user.setScheduleEnabled.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await refresh();
      toast(vars.enabled ? tx("Following your schedule") : tx("Schedule off: manual control only"), vars.enabled ? "success" : "info");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const resume = apiR.user.resumeSchedule.useMutation({
    onSuccess: async () => {
      haptic(20);
      await refresh();
      toast(tx("Back on schedule"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  return { setEnabled, resume };
}

/** tx("Follow schedule") switch at the top of the Schedule tab. */
export const ScheduleSwitch: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // "Follow schedule" and the manual pause of the side on the top bar (Both follows Left)
  const { scheduleSide: side } = useSide();
  const st = account.data?.sides[side] ?? { scheduleEnabled: true, manualHoldUntil: null, hasSchedule: false };
  const { setEnabled, resume } = useScheduleActions();
  const a = account.data;
  const on = st.scheduleEnabled ?? true;
  const hold = st.manualHoldUntil ?? null;

  return (
    <div
      className={`rounded-3xl border p-4 ${
        on ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30" : "border-slate-200/80 bg-white/90 dark:border-slate-800/80 dark:bg-slate-900/70"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {on ? <CalendarCheck className="h-5 w-5 shrink-0 text-emerald-600" /> : <CalendarOff className="h-5 w-5 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900 dark:text-slate-200">{tx("Follow schedule")}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {!on
                ? tx("Off: nothing changes automatically. You control the pod by hand.")
                : hold
                ? tx("Paused for your manual change until {time}", { time: clock(hold) })
                : tx("The pod follows Your night automatically")}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={tx("Follow schedule")}
          disabled={!a || setEnabled.isPending}
          onClick={() => setEnabled.mutate({ enabled: !on, side })}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
        >
          {setEnabled.isPending ? (
            <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
          ) : (
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
          )}
        </button>
      </div>
      {on && hold && (
        <button
          type="button"
          onClick={() => resume.mutate({ side })}
          disabled={resume.isPending}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-50"
        >
          {resume.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {tx("Resume schedule now")}
        </button>
      )}
    </div>
  );
};

/** Small tx("Follow schedule") switch for the Your night header. */
export const FollowToggle: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // "Follow schedule" and the manual pause of the side on the top bar (Both follows Left)
  const { scheduleSide: side } = useSide();
  const st = account.data?.sides[side] ?? { scheduleEnabled: true, manualHoldUntil: null, hasSchedule: false };
  const { setEnabled } = useScheduleActions();
  const on = st.scheduleEnabled ?? true;
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2">
      <span className={`text-[11px] font-bold ${on ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
        {inUseLabel(on)}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={tx("Follow schedule")}
        disabled={!account.data || setEnabled.isPending}
        onClick={() => setEnabled.mutate({ enabled: !on, side })}
        className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
      >
        {setEnabled.isPending ? (
          <Loader2 className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
        ) : (
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        )}
      </button>
    </label>
  );
};

/** One-line status under the Your night header: off, or paused by a manual change. */
export const FollowNotice: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // "Follow schedule" and the manual pause of the side on the top bar (Both follows Left)
  const { scheduleSide: side } = useSide();
  const st = account.data?.sides[side] ?? { scheduleEnabled: true, manualHoldUntil: null, hasSchedule: false };
  const a = account.data;
  if (!a) return null;
  if (side === "both") {
    return (
      <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {st.scheduleEnabled
          ? tx("In use: both sides follow this night; the Left and Right schedules wait.")
          : tx("Not in use: Left and Right follow their own nights. Switch on \"Use tonight\" to run this one on both sides instead.")}
      </p>
    );
  }
  return <ScheduleStatusLine className="mb-3" />;
};

/** Home banner: shows only when the schedule is off or paused by a manual change. */
export const ScheduleBanner: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // "Follow schedule" and the manual pause of the side on the top bar (Both follows Left)
  const { scheduleSide: side } = useSide();
  const st = account.data?.sides[side] ?? { scheduleEnabled: true, manualHoldUntil: null, hasSchedule: false };
  const { setEnabled, resume } = useScheduleActions();
  const a = account.data;
  if (!a || a.vacationMode) return null;

  if (!st.scheduleEnabled) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-slate-300 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <CalendarOff className="h-5 w-5 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">{tx("Schedule is off")}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{tx("Manual control only. Nothing changes automatically.")}</p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled.mutate({ enabled: true, side })}
          disabled={setEnabled.isPending}
          className="h-10 shrink-0 rounded-2xl bg-emerald-600 px-4 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
        >
          {tx("Turn on")}
        </button>
      </div>
    );
  }

  if (st.manualHoldUntil) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <Hand className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-amber-900 dark:text-amber-100">{tx("Manual until {time}", { time: clock(st.manualHoldUntil) })}</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">{tx("Your change stays; the schedule takes over at its next stage.")}</p>
        </div>
        <button
          type="button"
          onClick={() => resume.mutate({ side })}
          disabled={resume.isPending}
          className="h-10 shrink-0 rounded-2xl bg-amber-600 px-4 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
        >
          {tx("Resume")}
        </button>
      </div>
    );
  }
  return null;
};

"use client";

import React from "react";
import { CircleHelp, Loader2 } from "lucide-react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { Sheet } from "~/components/ui/sheet";
import { useSide } from "~/components/sideContext";
import { useHotNight } from "~/components/sideStatus";
import { useScheduleZone, gapWords, zoneCity } from "~/components/scheduleZone";
import { explainSchedule, type Why, type WhyInput } from "~/lib/scheduleWhy";
import { deviceZone } from "~/lib/scheduleTime";
import { haptic } from "~/lib/clientStorage";
import { useLevelFormat } from "~/lib/tempUnit";
import { tx, txLocale } from "~/lib/i18n";

const STAGE: Record<string, string> = {
  preheat: "Pre-cool",
  initial: "Falling asleep",
  mid: "Deep sleep",
  final: "Late sleep",
  prewake: "Pre-wake",
  alarm: "Waking up",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A moment on the phone's clock, with the day when it isn't today. */
function when(d: Date, now: Date) {
  const time = d.toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return time;
  if (diff === 1) return tx("tomorrow {time}", { time });
  return `${tx(DAYS[d.getDay()]!)} ${time}`;
}

/** What the schedule is doing for the selected side, in one answer (the same logic the 5-minute check uses). */
export function useScheduleWhy(sideOverride?: "left" | "right" | "both") {
  const { scheduleSide } = useSide();
  const side = sideOverride ?? scheduleSide;
  const hot = !!useHotNight();
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const left = apiR.user.getUserTemperatureProfile.useQuery({ side: "left" }, { staleTime: 60_000 });
  const right = apiR.user.getUserTemperatureProfile.useQuery({ side: "right" }, { staleTime: 60_000 });
  const whole = apiR.user.getUserTemperatureProfile.useQuery({ side: "both" }, { staleTime: 60_000 });
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const a = account.data;
  if (!a) return null;
  const profile = (side === "both" ? whole.data : side === "left" ? left.data : right.data) ?? null;
  const st = a.sides[side];
  const input: WhyInput = {
    side,
    schedule: st.hasSchedule && profile ? (profile as unknown as WhyInput["schedule"]) : null,
    scheduleEnabled: st.scheduleEnabled,
    wholeBedInUse: a.sides.both.hasSchedule && a.sides.both.scheduleEnabled,
    vacation: a.vacationMode,
    manualHoldUntil: st.manualHoldUntil ? new Date(st.manualHoldUntil) : null,
    backoffUntil: a.eightBackoffUntil ? new Date(a.eightBackoffUntil) : null,
    authError: a.authError,
    hot,
    now,
    deviceTz: deviceZone(),
  };
  return { side, now, why: explainSchedule(input) };
}

/** The sentence for the status line: "Running: Deep sleep at 68°F until 4:00 AM". */
function useSentence() {
  const fmt = useLevelFormat();
  return (w: Why, now: Date): { text: string; tone: "ok" | "wait" | "warn" } => {
    switch (w.state) {
      case "none":
        return { text: tx("No schedule yet"), tone: "wait" };
      case "vacation":
        return { text: tx("Vacation mode: the schedule is paused"), tone: "wait" };
      case "wholebed":
        return { text: tx("The whole-bed schedule is in use, so this side waits"), tone: "wait" };
      case "off":
        return { text: tx("Not running: Follow schedule is off"), tone: "warn" };
      case "paused":
        return { text: tx("Paused for your manual change until {time}", { time: when(w.holdUntil!, now) }), tone: "warn" };
      case "problem":
        return w.fix === "signin"
          ? { text: tx("Not running: your Eight Sleep sign-in expired"), tone: "warn" }
          : { text: tx("Not running: Eight Sleep refused a request; trying again at {time}", { time: when(w.retryAt!, now) }), tone: "warn" };
      case "dayoff":
        return { text: tx("Not running tonight ({day} is switched off)", { day: tx(DAYS[w.weekday ?? 0]!) }), tone: "wait" };
      case "waiting":
        return { text: tx("Waiting: starts at {time}", { time: when(w.startsAt!, now) }), tone: "wait" };
      case "bedoff":
        return { text: tx("Bed off for {stage} until {time}", { stage: tx(STAGE[w.stage!] ?? w.stage!).toLowerCase(), time: w.until ? when(w.until, now) : "—" }), tone: "wait" };
      case "running":
        return {
          text: tx("Running: {stage} at {level} until {time}", { stage: tx(STAGE[w.stage!] ?? w.stage!), level: fmt.text(w.level!), time: w.until ? when(w.until, now) : "—" }),
          tone: "ok",
        };
    }
  };
}

const TONE = {
  ok: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  wait: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  warn: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
} as const;

/** One line: what the schedule is doing right now. Tap for the "Why?" sheet. */
export const ScheduleStatusLine: React.FC<{ className?: string }> = ({ className = "" }) => {
  const r = useScheduleWhy();
  const sentence = useSentence();
  const [open, setOpen] = React.useState(false);
  if (!r) return null;
  const s = sentence(r.why, r.now);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-semibold active:scale-[0.99] ${TONE[s.tone]} ${className}`}
      >
        <span className="min-w-0 flex-1">{s.text}</span>
        <span className="flex shrink-0 items-center gap-1 font-bold opacity-80">
          <CircleHelp className="h-3.5 w-3.5" />
          {tx("Why?")}
        </span>
      </button>
      <WhySheet open={open} onClose={() => setOpen(false)} />
    </>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-right font-bold text-slate-900 dark:text-slate-100">{children}</span>
  </div>
);

export const WhySheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const r = useScheduleWhy();
  const sentence = useSentence();
  const fmt = useLevelFormat();
  const zone = useScheduleZone();
  const toast = useToast();
  const utils = apiR.useUtils();
  const refresh = () => Promise.all([utils.user.getAccount.invalidate(), utils.user.getPodStatus.invalidate()]);
  const resume = apiR.user.resumeSchedule.useMutation({
    onSuccess: async () => {
      haptic(20);
      await refresh();
      toast(tx("Back on schedule"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const enable = apiR.user.setScheduleEnabled.useMutation({
    onSuccess: async () => {
      haptic(20);
      await refresh();
      toast(tx("Following your schedule"), "success");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const check = apiR.user.runCronNow.useMutation({
    onSuccess: async (d) => {
      await refresh();
      toast(d.mine.length ? tx("Checked just now") : tx("Checked: nothing to change"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const history = apiR.user.getCronHistory.useQuery({ days: 1 }, { enabled: open, staleTime: 30_000 });
  if (!r) return null;
  const { why, now, side } = r;
  const s = sentence(why, now);
  const lastRun = history.data?.[0];
  const lastAt = lastRun ? new Date(lastRun.ranAt) : null;

  return (
    <Sheet open={open} onClose={onClose} title={tx("Why is it like this?")} icon={<CircleHelp className="h-5 w-5" />}>
      <p className={`rounded-2xl px-3 py-2.5 text-sm font-bold ${TONE[s.tone]}`}>{s.text}</p>
      <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        <Row label={tx("Side")}>{tx(side === "left" ? "Left" : side === "right" ? "Right" : "Whole bed")}</Row>
        {why.stage && why.level !== undefined && (
          <Row label={tx("The schedule wants")}>
            {tx(STAGE[why.stage] ?? why.stage)} · {why.level === null ? tx("bed off") : fmt.text(why.level)}
          </Row>
        )}
        {why.next && (
          <Row label={tx("Next change")}>
            {when(why.next.at, now)} · {tx(STAGE[why.next.stage] ?? why.next.stage)} {why.next.level === null ? `(${tx("bed off")})` : `· ${fmt.text(why.next.level)}`}
          </Row>
        )}
        {zone.zone && (
          <Row label={tx("Schedule clock")}>
            {zoneCity(zone.zone)}
            {zone.gap !== 0 ? ` · ${gapWords(zone.gap)} ${zone.gap < 0 ? tx("behind") : tx("ahead of")} ${tx("your phone")}` : ` · ${tx("same as your phone")}`}
          </Row>
        )}
        <Row label={tx("Last check")}>{history.isLoading ? "…" : lastAt && !isNaN(lastAt.getTime()) ? when(lastAt, now) : tx("none in the last day")}</Row>
      </div>
      <div className="mt-3 grid gap-2">
        {why.fix === "resume" && (
          <button type="button" disabled={resume.isPending} onClick={() => resume.mutate({ side })} className="h-11 rounded-2xl bg-amber-600 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50">
            {tx("Resume schedule now")}
          </button>
        )}
        {why.fix === "switchOn" && (
          <button type="button" disabled={enable.isPending} onClick={() => enable.mutate({ enabled: true, side })} className="h-11 rounded-2xl bg-emerald-600 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50">
            {tx("Switch the schedule on")}
          </button>
        )}
        {zone.mismatch && zone.zone && (
          <button type="button" disabled={zone.set.isPending} onClick={() => zone.set.mutate({ timezone: zone.device })} className="h-11 rounded-2xl bg-indigo-600 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50">
            {tx("Use my phone's time ({zone})", { zone: zoneCity(zone.device) })}
          </button>
        )}
        <button
          type="button"
          disabled={check.isPending}
          onClick={() => check.mutate(undefined)}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-slate-200 text-sm font-bold text-slate-700 active:scale-[0.98] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
        >
          {check.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {tx("Run the check now")}
        </button>
      </div>
    </Sheet>
  );
};

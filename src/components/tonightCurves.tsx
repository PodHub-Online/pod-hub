"use client";

import React from "react";
import { ChevronRight, Moon } from "lucide-react";
import { apiR } from "~/trpc/react";
import { CurveChart } from "~/components/temperatureCurveGraph";
import { useHotNight, useTonight } from "~/components/sideStatus";
import { type ScheduleValues } from "~/lib/presets";
import { forTonight, hotPlan } from "~/lib/schedule";
import { tx } from "~/lib/i18n";
import { ScheduleStatusLine } from "~/components/scheduleWhyUi";
import { ScheduleZoneNote } from "~/components/scheduleZone";
import { wallClock } from "~/lib/scheduleCore";
import { deviceZone, gapMinutes } from "~/lib/scheduleTime";

const EditLink: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} className="flex shrink-0 items-center gap-0.5 text-xs font-extrabold text-indigo-600 active:scale-95 dark:text-indigo-300">
    {tx("Edit")}
    <ChevronRight className="h-4 w-4" />
  </button>
);

const gapOf = (p: { timezoneTZ?: string | null } | null | undefined) => gapMinutes(p?.timezoneTZ, deviceZone());

type ProfileRow = ScheduleValues & { preheatLeadMinutes: number | null };

const toValues = (p: ProfileRow): ScheduleValues => ({
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
  preheatLeadMinutes: p.preheatLeadMinutes ?? 60,
  // stages switched off on the Schedule tab: the curve shows the gap
  offStages: p.offStages ?? 0,
});

/**
 * Home: what tonight will look like. One curve for the whole bed when that schedule is in
 * use; otherwise a curve for each side that runs, and a short "off tonight" line for one
 * that doesn't. It stays put while you swipe between sides.
 */
export const TonightCurves: React.FC<{ onOpen?: (side: "left" | "right" | "both") => void }> = ({ onOpen }) => (
  <div className="space-y-3">
    <ScheduleStatusLine />
    <TonightCurvesInner onOpen={onOpen} />
  </div>
);

const TonightCurvesInner: React.FC<{ onOpen?: (side: "left" | "right" | "both") => void }> = ({ onOpen }) => {
  const tonight = useTonight();
  // on a hot night the schedule starts earlier and colder; show what will really happen
  const hot = useHotNight();
  const tonightOf = <T extends ProfileRow>(p: T | null | undefined) => {
    const t = forTonight(p, p ? wallClock(new Date(), (p as { timezoneTZ?: string }).timezoneTZ ?? deviceZone()) : undefined);
    return t && hot ? hotPlan(t) : t;
  };
  const hotNote = hot ? ` · ${tx(hot === "room" ? "warm room" : "hot night")}` : "";
  const left = apiR.user.getUserTemperatureProfile.useQuery({ side: "left" }, { staleTime: 60_000 });
  const right = apiR.user.getUserTemperatureProfile.useQuery({ side: "right" }, { staleTime: 60_000 });
  const whole = apiR.user.getUserTemperatureProfile.useQuery({ side: "both" }, { staleTime: 60_000 });

  const wholePlan = tonight("both");
  if (wholePlan?.runs && whole.data) {
    return (
      <div className="space-y-2">
        <CurveChart values={toValues(tonightOf(whole.data as ProfileRow)!)} gap={gapOf(whole.data as ProfileRow & { timezoneTZ?: string })} action={onOpen && <EditLink onClick={() => onOpen("both")} />} title={tx("Tonight · Whole bed") + hotNote} />
        <ScheduleZoneNote />
      </div>
    );
  }

  const sides = (["left", "right"] as const).map((side) => {
    const plan = tonight(side);
    const profile = tonightOf((side === "left" ? left.data : right.data) as ProfileRow | undefined);
    return { side, plan, profile };
  });
  if (sides.every((s) => !s.plan)) return null;

  return (
    <div className="space-y-3">
      {sides.map(({ side, plan, profile }) => {
        const name = tx(side === "left" ? "Left" : "Right");
        if (plan?.runs && profile) {
          return <CurveChart key={side} compact values={toValues(profile)} gap={gapOf(profile as ProfileRow & { timezoneTZ?: string })} action={onOpen && <EditLink onClick={() => onOpen(side)} />} title={tx("Tonight · {side}", { side: name }) + hotNote} />;
        }
        // compact: this side won't run tonight
        return (
          <div
            key={side}
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={() => onOpen?.(side)}
            className="flex cursor-pointer items-center gap-3 rounded-3xl border border-slate-200/80 bg-white/90 px-5 py-3 text-sm dark:border-slate-800/80 dark:bg-slate-900/70"
          >
            <Moon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="font-extrabold text-slate-900 dark:text-slate-200">{tx("Tonight · {side}", { side: name })}</span>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
              {tx("Off")} {plan?.reason ? `· ${plan.reason}` : ""}
            </span>
          </div>
        );
      })}
      <ScheduleZoneNote />
    </div>
  );
};

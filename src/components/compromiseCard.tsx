"use client";

import React, { useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { useLevelFormat } from "~/lib/tempUnit";
import { tx } from "~/lib/i18n";

const LEANS = [
  { key: "left", label: "Lean toward Left", w: 0.75 },
  { key: "middle", label: "Middle", w: 0.5 },
  { key: "right", label: "Lean toward Right", w: 0.25 },
] as const;

const mins = (t: string) => {
  const [h = 0, m = 0] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
/** a bedtime as minutes from noon, so 23:30 comes before 00:15 */
const fromNoon = (t: string) => (mins(t) - 720 + 1440) % 1440;
const mix = (a: number, b: number, w: number) => Math.round((a * w + b * (1 - w)) / 10) * 10;

/**
 * Whole bed: fills the whole-bed schedule with the middle of both people's favorite levels
 * (or leaning toward one side). The earlier bedtime and the later wake-up, so nobody is left out.
 */
export const CompromiseCard: React.FC = () => {
  const fmt = useLevelFormat();
  const toast = useToast();
  const utils = apiR.useUtils();
  const left = apiR.user.getUserTemperatureProfile.useQuery({ side: "left" });
  const right = apiR.user.getUserTemperatureProfile.useQuery({ side: "right" });
  const whole = apiR.user.getUserTemperatureProfile.useQuery({ side: "both" });
  const [lean, setLean] = useState<(typeof LEANS)[number]>(LEANS[1]);
  const save = apiR.user.updateUserTemperatureProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.user.getUserTemperatureProfile.invalidate(), utils.user.getAccount.invalidate()]);
      toast(tx("Whole-bed schedule set to the compromise"));
    },
    onError: (e) => toast(e.message, "error"),
  });

  const l = left.data;
  const r = right.data;
  if (!l || !r) return null;
  const w = lean.w;
  const plan = {
    bedTime: (fromNoon(l.bedTime) <= fromNoon(r.bedTime) ? l.bedTime : r.bedTime).slice(0, 5),
    wakeupTime: (fromNoon(l.wakeupTime) >= fromNoon(r.wakeupTime) ? l.wakeupTime : r.wakeupTime).slice(0, 5),
    midStageSleepLevelStartTime: (w >= 0.5 ? l : r).midStageSleepLevelStartTime.slice(0, 5),
    finalSleepLevelStartTime: (w >= 0.5 ? l : r).finalSleepLevelStartTime.slice(0, 5),
    initialSleepLevel: mix(l.initialSleepLevel, r.initialSleepLevel, w),
    midStageSleepLevel: mix(l.midStageSleepLevel, r.midStageSleepLevel, w),
    finalSleepLevel: mix(l.finalSleepLevel, r.finalSleepLevel, w),
    wakeupAlarmEnabled: l.wakeupAlarmEnabled || r.wakeupAlarmEnabled,
    wakeupAlarmLevel: mix(l.wakeupAlarmLevel, r.wakeupAlarmLevel, w),
    wakeupAlarmLeadMinutes: Math.min(l.wakeupAlarmLeadMinutes, r.wakeupAlarmLeadMinutes),
    preWakeEnabled: !!l.preWakeEnabled || !!r.preWakeEnabled,
    preWakeLevel: mix(l.preWakeLevel ?? 10, r.preWakeLevel ?? 10, w),
    preWakeLeadMinutes: Math.max(l.preWakeLeadMinutes ?? 60, r.preWakeLeadMinutes ?? 60),
    preheatLeadMinutes: Math.max(l.preheatLeadMinutes, r.preheatLeadMinutes),
  };
  const rows: [string, number, number, number][] = [
    [tx("Falling asleep"), l.initialSleepLevel, r.initialSleepLevel, plan.initialSleepLevel],
    [tx("Deep sleep"), l.midStageSleepLevel, r.midStageSleepLevel, plan.midStageSleepLevel],
    [tx("Late sleep"), l.finalSleepLevel, r.finalSleepLevel, plan.finalSleepLevel],
  ];
  return (
    <Card>
      <CardHeader icon={<Scale className="h-5 w-5" />} title={tx("Compromise")} subtitle={tx("The whole bed at the middle of both people's favorite levels")} />
      <div className="mb-3 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
        <span />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("Left")}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("Right")}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{tx("Both")}</span>
        {rows.map(([name, a, b, c]) => (
          <React.Fragment key={name}>
            <span className="font-semibold">{name}</span>
            <span className="text-center font-hud text-slate-500">{fmt.short(a)}</span>
            <span className="text-center font-hud text-slate-500">{fmt.short(b)}</span>
            <span className="text-center font-hud text-base font-black text-indigo-600 dark:text-indigo-300">{fmt.short(c)}</span>
          </React.Fragment>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {plan.bedTime} → {plan.wakeupTime} · {tx("the earlier bedtime and the later wake-up")}
      </p>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        {LEANS.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setLean(x)}
            className={`h-9 rounded-xl text-[11px] font-bold transition ${lean.key === x.key ? "bg-white shadow dark:bg-slate-950" : "text-slate-500"}`}
          >
            {tx(x.label)}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            ...plan,
            side: "both",
            timezoneTZ: whole.data?.timezoneTZ ?? l.timezoneTZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            activeDays: whole.data?.activeDays ?? (l.activeDays | r.activeDays),
          })
        }
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-extrabold text-white transition active:scale-95 disabled:opacity-50"
      >
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {tx("Use for the whole bed")}
      </button>
    </Card>
  );
};

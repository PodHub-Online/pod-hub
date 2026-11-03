// Shared by client and server. Levels are stored in API units (-100..100),
// i.e. the UI's -10..10 scale multiplied by 10. Times are "HH:MM".

export interface ScheduleValues {
  bedTime: string;
  wakeupTime: string;
  midStageSleepLevelStartTime: string;
  finalSleepLevelStartTime: string;
  initialSleepLevel: number;
  midStageSleepLevel: number;
  finalSleepLevel: number;
  wakeupAlarmEnabled: boolean;
  wakeupAlarmLevel: number;
  wakeupAlarmLeadMinutes: number;
  /** Pre-wake: a step from preWakeLeadMinutes before wake-up until the wake-up warmth starts. */
  preWakeEnabled?: boolean;
  preWakeLevel?: number;
  /** Minutes before wake-up that Pre-wake starts (like the alarm's). */
  preWakeLeadMinutes?: number;
  /** Minutes before bedtime the pod turns on (pre-cool / pre-heat). 0 = at bedtime. */
  preheatLeadMinutes: number;
  /** Stages set to Off (the bed is off for them), as OFF bits. Missing = none. */
  offStages?: number;
}

/** Off bits: falling asleep (pre-cool follows it), deep sleep, late sleep, Pre-wake. */
export const OFF = { initial: 1, mid: 2, final: 4, prewake: 8 } as const;
export type OffStage = keyof typeof OFF;
export const isOff = (v: { offStages?: number | null }, stage: OffStage) => ((v.offStages ?? 0) & OFF[stage]) !== 0;
/** A stage's level, or null when it's set to Off. */
export const stageLevel = (v: { offStages?: number | null }, stage: OffStage, level: number) => (isOff(v, stage) ? null : level);

export interface PresetDescriptor {
  id: number;
  name: string;
  description: string;
  values: ScheduleValues;
}

export const PREHEAT_LEAD_OPTIONS = [0, 15, 30, 45, 60];
export const PRE_WAKE_LEAD_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180];
export const ALARM_LEAD_OPTIONS = [10, 15, 20, 30, 45, 60];

/**
 * Minutes before wake-up that Pre-wake starts, or 0 when it doesn't run: switched off, or not
 * starting before the wake-up warmth does.
 */
export function preWakeLead(v: Pick<ScheduleValues, "preWakeEnabled" | "preWakeLeadMinutes" | "wakeupAlarmEnabled" | "wakeupAlarmLeadMinutes">): number {
  const lead = v.preWakeLeadMinutes ?? 60;
  const warm = v.wakeupAlarmEnabled ? v.wakeupAlarmLeadMinutes : 0;
  return v.preWakeEnabled && lead > warm ? lead : 0;
}

/** "Pre-cool" / "Pre-heat" depending on the starting level */
export function preheatLabel(initialLevel: number): string {
  return initialLevel < 0 ? "Pre-cool" : initialLevel > 0 ? "Pre-heat" : "Warm-up";
}

/** "22:00:00" / "22:00:00.000000" / "22:00" → "22:00" */
export function toHHMM(time: string | null | undefined): string {
  return (time ?? "").slice(0, 5);
}

export function normalizeValues(v: ScheduleValues): ScheduleValues {
  return {
    ...v,
    bedTime: toHHMM(v.bedTime),
    wakeupTime: toHHMM(v.wakeupTime),
    midStageSleepLevelStartTime: toHHMM(v.midStageSleepLevelStartTime),
    finalSleepLevelStartTime: toHHMM(v.finalSleepLevelStartTime),
  };
}

export function sameSchedule(a: ScheduleValues, b: ScheduleValues): boolean {
  const x = normalizeValues(a);
  const y = normalizeValues(b);
  return (
    x.bedTime === y.bedTime &&
    x.wakeupTime === y.wakeupTime &&
    x.midStageSleepLevelStartTime === y.midStageSleepLevelStartTime &&
    x.finalSleepLevelStartTime === y.finalSleepLevelStartTime &&
    x.initialSleepLevel === y.initialSleepLevel &&
    x.midStageSleepLevel === y.midStageSleepLevel &&
    x.finalSleepLevel === y.finalSleepLevel &&
    x.preheatLeadMinutes === y.preheatLeadMinutes &&
    x.wakeupAlarmEnabled === y.wakeupAlarmEnabled &&
    // alarm details only matter while the alarm is on
    (!x.wakeupAlarmEnabled ||
      (x.wakeupAlarmLevel === y.wakeupAlarmLevel &&
        x.wakeupAlarmLeadMinutes === y.wakeupAlarmLeadMinutes)) &&
    (x.offStages ?? 0) === (y.offStages ?? 0) &&
    !!x.preWakeEnabled === !!y.preWakeEnabled &&
    // Pre-wake details only matter while it's on
    (!x.preWakeEnabled || ((x.preWakeLevel ?? 10) === (y.preWakeLevel ?? 10) && (x.preWakeLeadMinutes ?? 60) === (y.preWakeLeadMinutes ?? 60)))
  );
}

/** Returns the first preset whose values equal the given schedule. */
export function matchPreset(
  schedule: ScheduleValues | null | undefined,
  presets: PresetDescriptor[],
): PresetDescriptor | null {
  if (!schedule) return null;
  return presets.find((p) => sameSchedule(p.values, schedule)) ?? null;
}

export function formatLevel(level: number): string {
  // a degree setting can sit between two levels: one decimal at most ("-4.9")
  const scaled = Math.round(level) / 10;
  return scaled > 0 ? `+${scaled}` : `${scaled}`;
}

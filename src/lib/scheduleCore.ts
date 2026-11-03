// The schedule check's decision: what a side should be doing at a given moment.
// Pure (no database, no Eight Sleep), so the 5-minute check and the tests share it.
// Times are wall-clock Dates in the schedule's own timezone (see wallClock).
import { preWakeLead, stageLevel } from "~/lib/presets";
import { isWeekendNight, weekendTimes } from "~/lib/schedule";

export type NightStage = "off" | "preheat" | "initial" | "mid" | "final" | "prewake" | "alarm";

export interface SleepCycle {
  preHeatingTime: Date;
  bedTime: Date;
  midStageTime: Date;
  finalStageTime: Date;
  wakeupTime: Date;
}

/** The schedule fields the decision reads (a saved schedule row has all of them). */
export interface NightSchedule {
  bedTime: string;
  wakeupTime: string;
  midStageSleepLevelStartTime: string;
  finalSleepLevelStartTime: string;
  preheatLeadMinutes: number | null;
  initialSleepLevel: number;
  midStageSleepLevel: number;
  finalSleepLevel: number;
  wakeupAlarmEnabled: boolean;
  wakeupAlarmLevel: number;
  wakeupAlarmLeadMinutes: number | null;
  preWakeEnabled?: boolean | null;
  preWakeLevel?: number | null;
  preWakeLeadMinutes?: number | null;
  activeDays?: number | null;
  /** stages set to Off (OFF bits in presets.ts): the bed is off for them */
  offStages?: number | null;
  weekendDays?: number | null;
  weekendBedTime?: string | null;
  weekendWakeupTime?: string | null;
}

export const minutesOf = (t: string) => {
  const [h = 0, m = 0] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** "Now" as the clock on the wall in this timezone (the server runs in UTC). */
export const wallClock = (now: Date, tz: string) => new Date(now.toLocaleString("en-US", { timeZone: tz }));

function createDateWithTime(baseDate: Date, timeString: string): Date {
  const [hours, minutes] = timeString.split(':').map(Number);
  if (hours === undefined || minutes === undefined || isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time string: ${timeString}`);
  }
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function createSleepCycle(
  baseDate: Date,
  bedTimeStr: string,
  wakeupTimeStr: string,
  midStageSleepLevelStartTimeStr = "23:00",
  finalSleepLevelStartTimeStr = "06:00",
  preheatLeadMinutes = 60,
): SleepCycle {
  const preHeatingTime = createDateWithTime(baseDate, bedTimeStr);
  preHeatingTime.setMinutes(preHeatingTime.getMinutes() - preheatLeadMinutes);

  const bedTime = createDateWithTime(baseDate, bedTimeStr);
  let wakeupTime = createDateWithTime(baseDate, wakeupTimeStr);

  if (wakeupTime <= bedTime) {
    wakeupTime = addDays(wakeupTime, 1);
  }

  let midStageTime = createDateWithTime(baseDate, midStageSleepLevelStartTimeStr);
  if (midStageTime <= bedTime) {
    midStageTime = addDays(midStageTime, 1);
  }
  if (midStageTime >= wakeupTime) {
    midStageTime = new Date(bedTime.getTime() + 60 * 60 * 1000);
  }

  let finalStageTime = createDateWithTime(baseDate, finalSleepLevelStartTimeStr);
  if (finalStageTime <= bedTime) {
    finalStageTime = addDays(finalStageTime, 1);
  }
  if (finalStageTime >= wakeupTime || finalStageTime <= midStageTime) {
    finalStageTime = new Date(wakeupTime.getTime() - 60 * 60 * 1000);
  }

  return { preHeatingTime, bedTime, midStageTime, finalStageTime, wakeupTime };
}

type CycleFields = Pick<
  NightSchedule,
  "bedTime" | "wakeupTime" | "midStageSleepLevelStartTime" | "finalSleepLevelStartTime" | "preheatLeadMinutes" | "weekendDays" | "weekendBedTime" | "weekendWakeupTime"
>;

/** Last night's, tonight's and tomorrow night's cycles, each with its weekend times when it is a weekend night. */
function nearbyCycles(now: Date, schedule: CycleFields): SleepCycle[] {
  const build = (base: Date, s: CycleFields) =>
    createSleepCycle(base, s.bedTime, s.wakeupTime, s.midStageSleepLevelStartTime, s.finalSleepLevelStartTime, schedule.preheatLeadMinutes ?? 60);
  // a bedtime after midnight sits on the next calendar day but belongs to the same evening
  const morning = (t: string) => (minutesOf(t) < 720 ? 1 : 0);
  return [-1, 0, 1].map((d) => {
    const base = addDays(now, d);
    const usual = build(base, schedule);
    // weekend nights (by the evening the night starts) use their own bedtime and wake-up
    if (!isWeekendNight(schedule, usual.preHeatingTime.getDay())) return usual;
    const w = weekendTimes(schedule);
    return build(addDays(base, morning(w.bedTime) - morning(schedule.bedTime)), w);
  });
}

/**
 * The night that matters right now: the one running (pre-cool start ≤ now < wake-up), or else the
 * next one. Built from yesterday, today and tomorrow, so a bedtime at or after midnight
 * (e.g. 00:00 with pre-cool at 23:30) lands on the right night.
 */
export function currentCycle(now: Date, schedule: CycleFields): SleepCycle {
  const cycles = nearbyCycles(now, schedule);
  return (
    cycles.find((c) => c.preHeatingTime <= now && now < c.wakeupTime) ??
    cycles.filter((c) => c.preHeatingTime > now).sort((a, b) => a.preHeatingTime.getTime() - b.preHeatingTime.getTime())[0] ??
    cycles[1]!
  );
}

/** Minutes since the most recent wake-up (that night's own wake-up, weekend nights included). */
export function minutesSinceWake(now: Date, schedule: CycleFields): number {
  const past = nearbyCycles(now, schedule)
    .map((c) => c.wakeupTime.getTime())
    .filter((t) => t <= now.getTime());
  return past.length ? Math.floor((now.getTime() - Math.max(...past)) / 60_000) : Infinity;
}

export interface NightDecision {
  /** the night this moment belongs to (the running one, or the next) */
  cycle: SleepCycle;
  /** the night is switched off for its weekday (by the evening it starts) */
  dayOff: boolean;
  stage: NightStage;
  /** API units (-100..100); null = the side should be off (outside the night, or a stage set to Off) */
  level: number | null;
}

/**
 * What a side should be doing at this wall-clock moment. `plan` is the schedule as it runs
 * tonight (the hot-night version on a hot night); the stage levels after falling asleep and the
 * wake-up steps always come from `schedule`.
 */
export function decideStage(now: Date, schedule: NightSchedule, plan: NightSchedule = schedule): NightDecision {
  const cycle = currentCycle(now, plan);
  const activeDays = schedule.activeDays ?? 127;
  if (((activeDays >> cycle.preHeatingTime.getDay()) & 1) === 0) return { cycle, dayOff: true, stage: "off", level: null };

  const alarmStartTime = new Date(cycle.wakeupTime.getTime() - (schedule.wakeupAlarmLeadMinutes ?? 30) * 60 * 1000);
  // Pre-wake runs from its minutes before wake-up until the wake-up warmth starts
  const preWakeMin = preWakeLead({
    preWakeEnabled: schedule.preWakeEnabled ?? false,
    preWakeLeadMinutes: schedule.preWakeLeadMinutes ?? 60,
    wakeupAlarmEnabled: schedule.wakeupAlarmEnabled,
    wakeupAlarmLeadMinutes: schedule.wakeupAlarmLeadMinutes ?? 30,
  });
  const preWakeStartTime = new Date(cycle.wakeupTime.getTime() - preWakeMin * 60 * 1000);

  const at = (stage: NightStage, level: number | null): NightDecision => ({ cycle, dayOff: false, stage, level });
  if (now < cycle.preHeatingTime || now >= cycle.wakeupTime) return at("off", null);
  if (schedule.wakeupAlarmEnabled && now >= alarmStartTime) return at("alarm", schedule.wakeupAlarmLevel);
  // a stage set to Off keeps its name but has no level: the bed is off for it (pre-cool follows falling asleep)
  if (preWakeMin > 0 && now >= preWakeStartTime && now >= cycle.bedTime) return at("prewake", stageLevel(schedule, "prewake", schedule.preWakeLevel ?? 10));
  if (now < cycle.bedTime) return at("preheat", stageLevel(schedule, "initial", plan.initialSleepLevel));
  if (now < cycle.midStageTime) return at("initial", stageLevel(schedule, "initial", plan.initialSleepLevel));
  if (now < cycle.finalStageTime) return at("mid", stageLevel(schedule, "mid", schedule.midStageSleepLevel));
  return at("final", stageLevel(schedule, "final", schedule.finalSleepLevel));
}

export interface NightSegment {
  stage: NightStage;
  /** API units; null = the bed is off for this stretch */
  level: number | null;
  /** wall-clock Dates (the schedule's own clock) */
  from: Date;
  to: Date;
}

/**
 * The running (or next) night as a list of stretches, each with its stage and level. Built by asking
 * decideStage at every moment something can change, so it always agrees with what the check does.
 * Empty when that night is switched off for its weekday.
 */
export function nightSegments(now: Date, schedule: NightSchedule, plan: NightSchedule = schedule): { cycle: SleepCycle; dayOff: boolean; segments: NightSegment[] } {
  const first = decideStage(now, schedule, plan);
  const cycle = first.cycle;
  if (first.dayOff) return { cycle, dayOff: true, segments: [] };
  const wake = cycle.wakeupTime.getTime();
  const preWakeMin = preWakeLead({
    preWakeEnabled: schedule.preWakeEnabled ?? false,
    preWakeLeadMinutes: schedule.preWakeLeadMinutes ?? 60,
    wakeupAlarmEnabled: schedule.wakeupAlarmEnabled,
    wakeupAlarmLeadMinutes: schedule.wakeupAlarmLeadMinutes ?? 30,
  });
  const marks = [
    cycle.preHeatingTime.getTime(),
    cycle.bedTime.getTime(),
    cycle.midStageTime.getTime(),
    cycle.finalStageTime.getTime(),
    ...(preWakeMin > 0 ? [wake - preWakeMin * 60_000] : []),
    ...(schedule.wakeupAlarmEnabled ? [wake - (schedule.wakeupAlarmLeadMinutes ?? 30) * 60_000] : []),
    wake,
  ]
    .filter((t) => t >= cycle.preHeatingTime.getTime() && t <= wake)
    .sort((x, y) => x - y)
    .filter((t, i, all) => i === 0 || t !== all[i - 1]);
  const segments: NightSegment[] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const from = new Date(marks[i]!);
    const d = decideStage(from, schedule, plan);
    const last = segments[segments.length - 1];
    // neighbours with the same stage and level are one stretch
    if (last && last.stage === d.stage && last.level === d.level) last.to = new Date(marks[i + 1]!);
    else segments.push({ stage: d.stage, level: d.level, from, to: new Date(marks[i + 1]!) });
  }
  return { cycle, dayOff: false, segments };
}

/** After wake-up, keep checking for this long so a side left on gets turned off. */
export const AFTER_WAKE_CHECK_MIN = 60;

/** Does the check need to look at the Pod now? During the night always (Off stages too, to turn it off); after it, only for a while after wake-up. */
export function needsPod(now: Date, schedule: NightSchedule, decision: NightDecision): boolean {
  return decision.stage !== "off" || minutesSinceWake(now, schedule) < AFTER_WAKE_CHECK_MIN;
}

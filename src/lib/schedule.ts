import { formatLevel, preheatLabel, preWakeLead, stageLevel, toHHMM, type ScheduleValues } from "~/lib/presets";

export interface ScheduleEvent {
  key: "preheat" | "bed" | "mid" | "final" | "prewake" | "alarm" | "off";
  label: string;
  time: string; // HH:MM
  minutes: number; // minutes since midnight
  level: number | null; // API units, null = off
}

const toMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const fromMinutes = (total: number) => {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export { toMinutes, fromMinutes };

export const ALL_DAYS = 127;
/** Mon→Sun for display; value = JS getDay() (0 = Sunday) */
export const WEEK: { day: number; short: string; long: string }[] = [
  { day: 1, short: "M", long: "Monday" },
  { day: 2, short: "T", long: "Tuesday" },
  { day: 3, short: "W", long: "Wednesday" },
  { day: 4, short: "T", long: "Thursday" },
  { day: 5, short: "F", long: "Friday" },
  { day: 6, short: "S", long: "Saturday" },
  { day: 0, short: "S", long: "Sunday" },
];
export const isDayActive = (mask: number, day: number) => ((mask >> day) & 1) === 1;
export const toggleDay = (mask: number, day: number) => mask ^ (1 << day);

export function getScheduleEvents(values: ScheduleValues): ScheduleEvent[] {
  const bed = toMinutes(toHHMM(values.bedTime));
  const wake = toMinutes(toHHMM(values.wakeupTime));
  const mid = toMinutes(toHHMM(values.midStageSleepLevelStartTime));
  const final = toMinutes(toHHMM(values.finalSleepLevelStartTime));

  const lead = values.preheatLeadMinutes ?? 60;
  const events: ScheduleEvent[] = [];
  if (lead > 0) {
    events.push({ key: "preheat", label: preheatLabel(values.initialSleepLevel), time: fromMinutes(bed - lead), minutes: (bed - lead + 1440) % 1440, level: stageLevel(values, "initial", values.initialSleepLevel) });
  }
  events.push(
    { key: "bed", label: "Bedtime", time: fromMinutes(bed), minutes: bed, level: stageLevel(values, "initial", values.initialSleepLevel) },
    { key: "mid", label: "Deep sleep", time: fromMinutes(mid), minutes: mid, level: stageLevel(values, "mid", values.midStageSleepLevel) },
    { key: "final", label: "Late sleep", time: fromMinutes(final), minutes: final, level: stageLevel(values, "final", values.finalSleepLevel) },
  );
  const preWake = preWakeLead(values);
  if (preWake > 0) {
    const at = (wake - preWake + 1440) % 1440;
    events.push({ key: "prewake", label: "Pre-wake", time: fromMinutes(at), minutes: at, level: stageLevel(values, "prewake", values.preWakeLevel ?? 10) });
  }
  if (values.wakeupAlarmEnabled) {
    const alarm = (wake - values.wakeupAlarmLeadMinutes + 1440) % 1440;
    events.push({ key: "alarm", label: "Wake-up warmth", time: fromMinutes(alarm), minutes: alarm, level: values.wakeupAlarmLevel });
  }
  events.push({ key: "off", label: "Wake & off", time: fromMinutes(wake), minutes: wake, level: null });
  return events;
}

/** The next event after `now` (local time), wrapping around midnight. */
export function getNextEvent(values: ScheduleValues, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best: { event: ScheduleEvent; inMinutes: number } | null = null;
  for (const event of getScheduleEvents(values)) {
    const inMinutes = (event.minutes - nowMin + 1440) % 1440 || 1440;
    if (!best || inMinutes < best.inMinutes) best = { event, inMinutes };
  }
  return best;
}

export function describeLevel(level: number | null) {
  return level === null ? "Off" : formatLevel(level);
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function sleepDurationMinutes(values: ScheduleValues) {
  const bed = toMinutes(toHHMM(values.bedTime));
  const wake = toMinutes(toHHMM(values.wakeupTime));
  return (wake - bed + 1440) % 1440 || 1440;
}

// ---------- Weekend nights ----------

export interface WeekendFields {
  bedTime: string;
  wakeupTime: string;
  midStageSleepLevelStartTime: string;
  finalSleepLevelStartTime: string;
  weekendDays?: number | null;
  weekendBedTime?: string | null;
  weekendWakeupTime?: string | null;
}

/** Minutes after the evening's noon: 23:00 → 660, 00:30 → 750 (a bedtime after midnight still belongs to the evening before). */
const eveningMinutes = (hhmm: string) => (toMinutes(hhmm.slice(0, 5)) + 720) % 1440;

export const hasWeekend = (p: WeekendFields) => !!(p.weekendDays && p.weekendBedTime && p.weekendWakeupTime);

/**
 * The weekend version of a schedule: its own bedtime and wake-up, with deep sleep moved by
 * as much as bedtime moved and late sleep by as much as wake-up moved.
 */
export function weekendTimes<T extends WeekendFields>(p: T): T {
  if (!hasWeekend(p)) return p;
  const bedShift = eveningMinutes(p.weekendBedTime!) - eveningMinutes(p.bedTime);
  const wakeShift = eveningMinutes(p.weekendWakeupTime!) - eveningMinutes(p.wakeupTime);
  return {
    ...p,
    bedTime: p.weekendBedTime!.slice(0, 5),
    wakeupTime: p.weekendWakeupTime!.slice(0, 5),
    midStageSleepLevelStartTime: fromMinutes(toMinutes(p.midStageSleepLevelStartTime.slice(0, 5)) + bedShift),
    finalSleepLevelStartTime: fromMinutes(toMinutes(p.finalSleepLevelStartTime.slice(0, 5)) + wakeShift),
  };
}

/** Is the night that starts on this weekday (0 = Sunday) a weekend night? */
export const isWeekendNight = (p: WeekendFields, day: number) => hasWeekend(p) && isDayActive(p.weekendDays!, day);

/** The schedule for tonight (the evening before noon counts as last night). */
export function forTonight<T extends WeekendFields>(p: T | null | undefined, now = new Date()): T | null | undefined {
  if (!p || !hasWeekend(p)) return p;
  const evening = new Date(now.getTime() - (now.getHours() < 12 ? 24 * 3_600_000 : 0));
  return isWeekendNight(p, evening.getDay()) ? weekendTimes(p) : p;
}

// ---------- Hot nights ----------

/** A hot night (forecast or a warm bedroom): pre-cool this much earlier, and falling asleep this many steps colder. */
export const HOT_EXTRA_LEAD_MIN = 30;
export const HOT_EXTRA_STEPS = 1;

/** Tonight's plan on a hot night. The schedule check and the curves on Home both use this. */
export function hotPlan<T extends { preheatLeadMinutes: number | null; initialSleepLevel: number }>(p: T): T {
  return {
    ...p,
    preheatLeadMinutes: (p.preheatLeadMinutes ?? 60) + HOT_EXTRA_LEAD_MIN,
    initialSleepLevel: Math.max(-100, p.initialSleepLevel - HOT_EXTRA_STEPS * 10),
  };
}

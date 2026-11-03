// Time zones for schedules. A schedule's times ("in bed 22:30") are the clock in ITS OWN time
// zone (the one saved with it), and that clock is what the 5-minute check runs on. Your phone can
// be on another zone, so anything shown next to your phone's clock goes through these helpers.
// Shared by the screens and the tests (no server code in here).

const MIN = 60_000;

export function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone this device is on ("America/New_York"). */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Minutes this zone is ahead of UTC at that moment (New York in winter: -300). */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MIN);
}

/**
 * How far the schedule's clock is from this device's clock, in minutes: negative = the schedule's
 * clock is BEHIND your phone (its "4:00 PM" is 5:00 PM for you), positive = ahead. 0 = the same.
 */
export function gapMinutes(scheduleTz: string | null | undefined, deviceTz: string, at: Date = new Date()): number {
  if (!isValidZone(scheduleTz) || !isValidZone(deviceTz) || scheduleTz === deviceTz) return 0;
  return zoneOffsetMinutes(scheduleTz, at) - zoneOffsetMinutes(deviceTz, at);
}

/** A clock time in the schedule's zone, as minutes since midnight on this device's clock. */
export function toDeviceMinutes(scheduleMinutes: number, gap: number): number {
  return (((scheduleMinutes - gap) % 1440) + 1440) % 1440;
}

/** "HH:MM" of a clock time in the schedule's zone, on this device's clock. */
export function toDeviceHHMM(hhmm: string, gap: number): string {
  const [h = 0, m = 0] = hhmm.slice(0, 5).split(":").map(Number);
  const t = toDeviceMinutes(h * 60 + m, gap);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** The moment (a real instant) when the schedule's wall clock reads `wall`, given the clock it reads now. */
export function wallToInstant(wall: Date, wallNow: Date, now: Date): Date {
  return new Date(now.getTime() + (wall.getTime() - wallNow.getTime()));
}

/** "Eastern Time" style label for a zone: "America/New_York" → { city: "New York", abbrev: "EST" }. */
export function zoneLabel(tz: string, at: Date = new Date()): { city: string; abbrev: string } {
  const city = (tz.split("/").pop() ?? tz).replace(/_/g, " ");
  let abbrev = "";
  try {
    abbrev = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    // keep it empty
  }
  return { city, abbrev };
}

/** "1 hour", "2 hours", "30 minutes", "1 h 30 min" for a gap (sign ignored). */
export function gapText(gap: number): { hours: number; minutes: number } {
  const a = Math.abs(gap);
  return { hours: Math.floor(a / 60), minutes: a % 60 };
}

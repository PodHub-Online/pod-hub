// "Why is it running, or not?": what a side's schedule is doing right now, in one answer.
// Pure (no screens, no server), so the status line, the Why sheet and the tests share it. It asks the
// same functions the 5-minute check uses (decideStage / nightSegments), and every time it returns is a
// real moment, so a screen can show it on the phone's own clock whatever zone the schedule is in.
import { hotPlan } from "~/lib/schedule";
import { nightSegments, wallClock, type NightSchedule, type NightStage } from "~/lib/scheduleCore";
import { gapMinutes, isValidZone, wallToInstant } from "~/lib/scheduleTime";

export type WhyState =
  | "none" //      no schedule saved
  | "vacation" //  Vacation mode
  | "wholebed" //  the whole-bed schedule is in use, so this side's waits
  | "off" //       Follow schedule is off
  | "paused" //    a manual change paused it
  | "problem" //   Eight Sleep refused (or the sign-in expired)
  | "dayoff" //    this night is switched off
  | "waiting" //   not the night yet
  | "running" //   in the night, bed on
  | "bedoff"; //   in the night, but the bed is off for this stage (ticked off)

export type WhyFix = "setup" | "resume" | "switchOn" | "signin";

export interface WhyInput {
  side: "left" | "right" | "both";
  schedule: (NightSchedule & { timezoneTZ: string }) | null;
  scheduleEnabled: boolean;
  /** a Left or Right schedule waits while the whole-bed one is in use */
  wholeBedInUse: boolean;
  vacation: boolean;
  manualHoldUntil: Date | null;
  /** Eight Sleep refused earlier: the check leaves this account alone until then */
  backoffUntil: Date | null;
  authError: boolean;
  hot: boolean;
  now: Date;
  /** the zone of the device showing this */
  deviceTz: string;
}

export interface WhyStep {
  at: Date;
  stage: NightStage;
  level: number | null;
}

export interface Why {
  state: WhyState;
  /** the schedule's clock minus the phone's clock, in minutes (negative = behind); 0 when they match */
  gap: number;
  stage?: NightStage;
  level?: number | null;
  /** when the current stretch ends */
  until?: Date;
  /** the next change */
  next?: WhyStep;
  /** waiting: when the night starts */
  startsAt?: Date;
  /** dayoff: the weekday of the skipped night, 0 = Sunday */
  weekday?: number;
  holdUntil?: Date;
  retryAt?: Date;
  fix?: WhyFix;
}

export function explainSchedule(i: WhyInput): Why {
  const sched = i.schedule;
  const gap = sched ? gapMinutes(sched.timezoneTZ, i.deviceTz, i.now) : 0;
  if (!sched) return { state: "none", gap, fix: "setup" };
  if (i.vacation) return { state: "vacation", gap };
  if (i.side !== "both" && i.wholeBedInUse) return { state: "wholebed", gap };
  if (i.authError) return { state: "problem", gap, fix: "signin" };
  if (!i.scheduleEnabled) return { state: "off", gap, fix: "switchOn" };
  if (i.manualHoldUntil && i.manualHoldUntil > i.now) return { state: "paused", gap, holdUntil: i.manualHoldUntil, fix: "resume" };
  if (i.backoffUntil && i.backoffUntil > i.now) return { state: "problem", gap, retryAt: i.backoffUntil };

  // the schedule's own clock decides everything; real moments are worked out from it
  const tz = isValidZone(sched.timezoneTZ) ? sched.timezoneTZ : i.deviceTz;
  const wc = wallClock(i.now, tz);
  const plan = i.hot ? hotPlan(sched) : sched;
  const { cycle, dayOff, segments } = nightSegments(wc, sched, plan);
  const real = (d: Date) => wallToInstant(d, wc, i.now);
  if (dayOff) return { state: "dayoff", gap, weekday: cycle.preHeatingTime.getDay(), startsAt: real(cycle.preHeatingTime) };

  const idx = segments.findIndex((s) => wc >= s.from && wc < s.to);
  const step = (s: (typeof segments)[number] | undefined): WhyStep | undefined => (s ? { at: real(s.from), stage: s.stage, level: s.level } : undefined);
  if (idx < 0) return { state: "waiting", gap, startsAt: real(cycle.preHeatingTime), next: step(segments[0]) };
  const cur = segments[idx]!;
  return { state: cur.level === null ? "bedoff" : "running", gap, stage: cur.stage, level: cur.level, until: real(cur.to), next: step(segments[idx + 1]) };
}

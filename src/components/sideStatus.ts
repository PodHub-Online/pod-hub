"use client";

import { apiR } from "~/trpc/react";
import { tx, txLocale } from "~/lib/i18n";
import { type BedSideName } from "~/components/sideContext";
import { forTonight, getNextEvent, getScheduleEvents, hotPlan, type WeekendFields } from "~/lib/schedule";
import { type ScheduleValues } from "~/lib/presets";
import { wallClock } from "~/lib/scheduleCore";
import { deviceZone, gapMinutes, isValidZone, toDeviceHHMM } from "~/lib/scheduleTime";

// A schedule's times are the clock of ITS OWN time zone, not the phone's. "Now" for a schedule is the
// wall clock in that zone, and times shown next to the phone's clock are moved onto it.
const wallClockOf = (now: Date, tz: string | null | undefined) => (isValidZone(tz) ? wallClock(now, tz) : now);
const gapOf = (tz: string | null | undefined) => gapMinutes(tz, deviceZone());

export interface ScheduleStatus {
  /** "Auto", "Auto · on at 22:30", "Manual until 03:00", "Schedule off", "No schedule", "Vacation" */
  text: string;
  /** shorter version for the bed tags: "Auto · 22:30", "Manual · 03:00" */
  short: string;
  /** one plain sentence for the controller: "Schedule: deep sleep until 04:00", "Turns on at 23:30 (schedule)" */
  detail: string;
  /** what tapping the detail does, if anything */
  action?: "setup" | "resume";
  tone: "auto" | "manual" | "off";
}

const clock = (d: Date | string) => new Date(d).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" });

/** "23:00" minus 30 min → "22:30" */
const minusMinutes = (hhmm: string, minutes: number) => {
  const [h = 0, m = 0] = hhmm.slice(0, 5).split(":").map(Number);
  const t = (((h * 60 + m - minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

const STAGE_NAME: Record<string, string> = {
  preheat: "pre-cool",
  bed: "in bed",
  mid: "deep sleep",
  final: "late sleep",
  alarm: "wake-up warmth",
};

/** The stage the schedule is in right now and when it changes, e.g. "deep sleep until 04:00". */
function currentStage(values: ScheduleValues, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const events = getScheduleEvents(values);
  // the event that started most recently
  const current = events.reduce<{ key: string; ago: number } | null>((best, e) => {
    const ago = (nowMin - e.minutes + 1440) % 1440;
    return !best || ago < best.ago ? { key: e.key, ago } : best;
  }, null);
  const next = getNextEvent(values, now);
  if (!current || !next || current.key === "off") return null;
  const name = current.key === "preheat" && values.initialSleepLevel > 0 ? "pre-heat" : STAGE_NAME[current.key] ?? current.key;
  return { name, until: next.event.time };
}

/**
 * Is tonight a hot night, the same way the schedule check decides it: the forecast at home
 * says hot, or the Pod's room sensor read a warm bedroom last night.
 */
export function useHotNight() {
  const extras = apiR.fun.getExtras.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const room = apiR.more.getRoom.useQuery(undefined, { staleTime: 30 * 60_000, retry: false });
  const x = extras.data;
  const r = room.data;
  const weather = !!x?.weatherEnabled && !!x.weather?.hot;
  const warmRoom = !!r?.enabled && r.lastC !== null && r.lastC >= r.threshold;
  return weather ? "weather" : warmRoom ? "room" : null;
}

/** Tonight's plan for a schedule: weekend times when it's a weekend night, earlier and colder when it's hot. */
function planFor<T extends WeekendFields & { preheatLeadMinutes: number | null; initialSleepLevel: number; timezoneTZ?: string }>(p: T | null | undefined, hot: boolean): T | null | undefined {
  const t = forTonight(p, wallClockOf(new Date(), p?.timezoneTZ));
  return t && hot ? hotPlan(t) : t;
}

/** Schedule state of each side, for the bed tags and the controller. */
export function useScheduleStatus() {
  const hot = !!useHotNight();
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const left = apiR.user.getUserTemperatureProfile.useQuery({ side: "left" }, { retry: 1, staleTime: 60_000 });
  const right = apiR.user.getUserTemperatureProfile.useQuery({ side: "right" }, { retry: 1, staleTime: 60_000 });
  const whole = apiR.user.getUserTemperatureProfile.useQuery({ side: "both" }, { retry: 1, staleTime: 60_000 });

  return (bedSide: BedSideName, isOn: boolean): ScheduleStatus | null => {
    const a = account.data;
    if (!a) return null;
    if (a.vacationMode) return { text: tx("Vacation"), short: tx("Vacation"), detail: tx("Vacation mode: the schedule is paused"), tone: "off" };
    // the whole-bed schedule, when it's in use, is what drives every side
    const wholeInUse = a.sides.both.hasSchedule && a.sides.both.scheduleEnabled && !!whole.data;
    const side = wholeInUse ? "both" : bedSide;
    const st = a.sides[side];
    const profile = planFor(side === "both" ? whole.data : side === "left" ? left.data : right.data, hot);
    if (!st.hasSchedule || !profile) {
      return { text: tx("No schedule"), short: tx("No schedule"), detail: tx("No schedule · set one up ›"), action: "setup", tone: "off" };
    }
    if (!st.scheduleEnabled) {
      return { text: tx("Schedule off"), short: tx("Manual"), detail: tx("Schedule off: you control it by hand"), tone: "off" };
    }
    if (st.manualHoldUntil) {
      const time = clock(st.manualHoldUntil);
      return {
        text: tx("Manual until {time}", { time }),
        short: `${tx("Manual")} · ${time}`,
        detail: tx("Your change holds until {time} · resume schedule ›", { time }),
        action: "resume",
        tone: "manual",
      };
    }
    // shown on the phone's clock, whatever zone the schedule runs on
    const gap = gapOf(profile.timezoneTZ);
    const onAt = toDeviceHHMM(minusMinutes(profile.bedTime, profile.preheatLeadMinutes ?? 60), gap);
    if (!isOn) {
      // off for now: say when the schedule turns it on
      return {
        text: tx("Auto · on at {time}", { time: onAt }),
        short: `${tx("Auto")} · ${onAt}`,
        detail: tx("Turns on at {time} (schedule)", { time: onAt }),
        tone: "auto",
      };
    }
    const found = currentStage(profile as unknown as ScheduleValues, wallClockOf(new Date(), profile.timezoneTZ));
    const stage = found && { ...found, until: toDeviceHHMM(found.until, gap) };
    return {
      text: tx("Auto"),
      short: tx("Auto"),
      detail: stage ? tx("Schedule: {stage} until {time}", { stage: tx(stage.name), time: stage.until }) : tx("Following the schedule"),
      tone: "auto",
    };
  };
}

export interface TonightPlan {
  runs: boolean;
  /** when the schedule turns this side on and off tonight, e.g. "23:30" → "08:00" */
  onAt?: string;
  offAt?: string;
  /** why it won't run: "No schedule", "Schedule off", "Night off", "Vacation" */
  reason?: string;
}

const toMin = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Whether each side's schedule will run tonight (the night that's running or coming next). */
export function useTonight() {
  const hot = !!useHotNight();
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const left = apiR.user.getUserTemperatureProfile.useQuery({ side: "left" }, { retry: 1, staleTime: 60_000 });
  const right = apiR.user.getUserTemperatureProfile.useQuery({ side: "right" }, { retry: 1, staleTime: 60_000 });
  const whole = apiR.user.getUserTemperatureProfile.useQuery({ side: "both" }, { retry: 1, staleTime: 60_000 });

  return (side: BedSideName | "both", now = new Date()): TonightPlan | null => {
    const a = account.data;
    if (!a) return null;
    if (a.vacationMode) return { runs: false, reason: tx("Vacation") };
    const wholeInUse = a.sides.both.hasSchedule && a.sides.both.scheduleEnabled && !!whole.data;
    if (side === "both" && !wholeInUse) return { runs: false, reason: tx("Not in use") };
    if (side !== "both" && wholeInUse) return { runs: false, reason: tx("Whole-bed schedule") };
    const st = a.sides[side];
    const profile = planFor(side === "both" ? whole.data : side === "left" ? left.data : right.data, hot);
    if (!st.hasSchedule || !profile) return { runs: false, reason: tx("No schedule") };
    if (!st.scheduleEnabled) return { runs: false, reason: tx("Schedule off") };
    // the schedule's own clock decides which night this is
    const wall = wallClockOf(now, profile.timezoneTZ);
    const onAtWall = minusMinutes(profile.bedTime, profile.preheatLeadMinutes ?? 60);
    const offAtWall = profile.wakeupTime.slice(0, 5);
    // which calendar day this night counts as (same rule as the cron: the day it turns on)
    const nowMin = wall.getHours() * 60 + wall.getMinutes();
    const onMin = toMin(onAtWall);
    const offMin = toMin(offAtWall);
    const startsAfterMidnight = onMin < offMin;
    const night = new Date(wall);
    if (startsAfterMidnight) {
      if (nowMin >= offMin) night.setDate(night.getDate() + 1);
    } else if (nowMin < offMin) {
      night.setDate(night.getDate() - 1);
    }
    const runs = (((profile.activeDays ?? 127) >> night.getDay()) & 1) === 1;
    // the times people read are on the phone's clock
    const gap = gapOf(profile.timezoneTZ);
    return runs ? { runs: true, onAt: toDeviceHHMM(onAtWall, gap), offAt: toDeviceHHMM(offAtWall, gap) } : { runs: false, reason: tx("Night off") };
  };
}

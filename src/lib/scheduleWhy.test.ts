import { describe, expect, it } from "vitest";
import { explainSchedule, type WhyInput } from "~/lib/scheduleWhy";
import { decideStage, nightSegments, wallClock, type NightSchedule } from "~/lib/scheduleCore";
import { OFF } from "~/lib/presets";
import { hotPlan } from "~/lib/schedule";

const base: NightSchedule & { timezoneTZ: string } = {
  bedTime: "23:00",
  wakeupTime: "07:00",
  midStageSleepLevelStartTime: "01:00",
  finalSleepLevelStartTime: "05:00",
  preheatLeadMinutes: 60,
  initialSleepLevel: -20,
  midStageSleepLevel: -30,
  finalSleepLevel: -10,
  wakeupAlarmEnabled: true,
  wakeupAlarmLevel: 20,
  wakeupAlarmLeadMinutes: 15,
  preWakeEnabled: true,
  preWakeLevel: 10,
  preWakeLeadMinutes: 60,
  activeDays: 127,
  timezoneTZ: "America/New_York",
};

// New York is on UTC-5 from 1 Nov 2026
const NYC = (day: string, hhmm: string) => new Date(new Date(`${day}T${hhmm}:00Z`).getTime() + 5 * 3_600_000);
const inZone = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

const input = (over: Partial<WhyInput> = {}): WhyInput => ({
  side: "left",
  schedule: base,
  scheduleEnabled: true,
  wholeBedInUse: false,
  vacation: false,
  manualHoldUntil: null,
  backoffUntil: null,
  authError: false,
  hot: false,
  now: NYC("2026-11-03", "23:30"),
  deviceTz: "America/New_York",
  ...over,
});

describe("what the schedule is doing right now", () => {
  it("in the night, bed on: running, with when this stretch ends and what comes next", () => {
    const w = explainSchedule(input({ now: NYC("2026-11-03", "23:30") }));
    expect(w).toMatchObject({ state: "running", stage: "initial", level: -20, gap: 0 });
    expect(inZone(w.until!, "America/New_York")).toBe("01:00");
    expect(w.next).toMatchObject({ stage: "mid", level: -30 });
  });

  it("before the night: waiting, with the start", () => {
    const w = explainSchedule(input({ now: NYC("2026-11-03", "15:00") }));
    expect(w.state).toBe("waiting");
    expect(inZone(w.startsAt!, "America/New_York")).toBe("22:00");
    expect(w.next).toMatchObject({ stage: "preheat", level: -20 });
  });

  it("after wake-up: waiting for the next night", () => {
    const w = explainSchedule(input({ now: NYC("2026-11-04", "08:00") }));
    expect(w.state).toBe("waiting");
    expect(inZone(w.startsAt!, "America/New_York")).toBe("22:00");
    expect(w.startsAt!.getTime()).toBeGreaterThan(NYC("2026-11-04", "08:00").getTime());
  });

  it("a stage ticked off: the bed is off for it", () => {
    const w = explainSchedule(input({ schedule: { ...base, offStages: OFF.mid }, now: NYC("2026-11-04", "02:00") }));
    expect(w).toMatchObject({ state: "bedoff", stage: "mid", level: null });
    expect(w.next).toMatchObject({ stage: "final", level: -10 });
  });

  it("a night switched off", () => {
    const w = explainSchedule(input({ schedule: { ...base, activeDays: 127 & ~(1 << 2) }, now: NYC("2026-11-03", "15:00") }));
    expect(w).toMatchObject({ state: "dayoff", weekday: 2 });
  });
});

describe("what takes priority", () => {
  it("no schedule", () => expect(explainSchedule(input({ schedule: null }))).toMatchObject({ state: "none", fix: "setup" }));
  it("vacation", () => expect(explainSchedule(input({ vacation: true })).state).toBe("vacation"));
  it("whole bed in use: a side waits, the whole bed doesn't", () => {
    expect(explainSchedule(input({ wholeBedInUse: true })).state).toBe("wholebed");
    expect(explainSchedule(input({ wholeBedInUse: true, side: "both" })).state).toBe("running");
  });
  it("Follow schedule off", () => expect(explainSchedule(input({ scheduleEnabled: false }))).toMatchObject({ state: "off", fix: "switchOn" }));
  it("a manual pause, until a time (and only while it lasts)", () => {
    const hold = NYC("2026-11-04", "01:00");
    expect(explainSchedule(input({ manualHoldUntil: hold }))).toMatchObject({ state: "paused", holdUntil: hold, fix: "resume" });
    expect(explainSchedule(input({ manualHoldUntil: NYC("2026-11-03", "23:00") })).state).toBe("running");
  });
  it("Eight Sleep refused earlier: a problem with the retry time", () => {
    const retry = NYC("2026-11-04", "00:30");
    expect(explainSchedule(input({ backoffUntil: retry }))).toMatchObject({ state: "problem", retryAt: retry });
    expect(explainSchedule(input({ backoffUntil: NYC("2026-11-03", "23:00") })).state).toBe("running");
  });
  it("an expired sign-in comes before everything else", () => {
    expect(explainSchedule(input({ authError: true, manualHoldUntil: NYC("2026-11-04", "01:00") }))).toMatchObject({ state: "problem", fix: "signin" });
  });
});

describe("a schedule on a different clock than the phone (what happened on 2 Nov)", () => {
  // The schedule is on New York time; the phone is on Santo Domingo (UTC-4, no daylight saving).
  // After the US clocks went back, the schedule's clock is 1 hour BEHIND the phone's.
  const sched = { ...base, bedTime: "17:00", wakeupTime: "23:00", midStageSleepLevelStartTime: "19:00", finalSleepLevelStartTime: "21:00" };
  // 3:36 PM on the phone = 2:36 PM on the schedule's clock
  const now = new Date("2026-11-03T19:36:00Z");

  it("sees the gap", () => {
    const w = explainSchedule(input({ schedule: sched, now, deviceTz: "America/Santo_Domingo" }));
    expect(w.gap).toBe(-60);
  });

  it("'pre-cool 4:00 PM' (bed 5:00 PM) really starts at 5:00 PM on the phone", () => {
    const w = explainSchedule(input({ schedule: sched, now, deviceTz: "America/Santo_Domingo" }));
    expect(w.state).toBe("waiting");
    expect(inZone(w.startsAt!, "America/New_York")).toBe("16:00"); // what the schedule says
    expect(inZone(w.startsAt!, "America/Santo_Domingo")).toBe("17:00"); // what the phone must show
  });

  it("on the phone's own 4:00 PM it is still waiting (the old Home said it had started)", () => {
    const w = explainSchedule(input({ schedule: sched, now: new Date("2026-11-03T20:00:00Z"), deviceTz: "America/Santo_Domingo" }));
    expect(w.state).toBe("waiting");
  });

  it("running stretches end on the phone's clock too", () => {
    const w = explainSchedule(input({ schedule: sched, now: new Date("2026-11-03T21:30:00Z"), deviceTz: "America/Santo_Domingo" }));
    // 5:30 PM on the phone = 4:30 PM on the schedule's clock: pre-cool (bed 5:00 PM schedule time)
    expect(w).toMatchObject({ state: "running", stage: "preheat" });
    expect(inZone(w.until!, "America/Santo_Domingo")).toBe("18:00");
  });
});

describe("the timeline never disagrees with the real check", () => {
  const schedules: Record<string, NightSchedule> = {
    normal: base,
    "after midnight": { ...base, bedTime: "00:30", wakeupTime: "08:00", midStageSleepLevelStartTime: "02:00", finalSleepLevelStartTime: "06:00" },
    "weekend nights": { ...base, weekendDays: (1 << 5) | (1 << 6), weekendBedTime: "00:30", weekendWakeupTime: "09:00" },
    "stages off": { ...base, offStages: OFF.initial | OFF.final },
    "pre-wake 3 h": { ...base, preWakeLeadMinutes: 180 },
    "afternoon test (stage times outside the window)": { ...base, bedTime: "14:10", wakeupTime: "21:00", midStageSleepLevelStartTime: "00:30", finalSleepLevelStartTime: "04:15", preWakeLeadMinutes: 180 },
    "no warmth, no pre-wake": { ...base, wakeupAlarmEnabled: false, preWakeEnabled: false },
  };
  for (const [name, s] of Object.entries(schedules)) {
    for (const hot of [false, true]) {
      it(`${name}${hot ? " (hot night)" : ""}: every 5 minutes for 3 days`, () => {
        const plan = hot ? hotPlan(s) : s;
        const start = new Date(2026, 10, 2, 0, 0).getTime(); // wall-clock Dates, like the check uses
        for (let t = start; t < start + 3 * 86_400_000; t += 5 * 60_000) {
          const wc = new Date(t);
          const d = decideStage(wc, s, plan);
          const { segments, dayOff } = nightSegments(wc, s, plan);
          if (d.dayOff) {
            expect(dayOff).toBe(true);
            continue;
          }
          const seg = segments.find((x) => wc >= x.from && wc < x.to);
          if (d.stage === "off") expect(seg).toBeUndefined();
          else expect(seg && { stage: seg.stage, level: seg.level }).toEqual({ stage: d.stage, level: d.level });
        }
      });
    }
  }

  it("wallClock round trip used above", () => {
    expect(wallClock(new Date("2026-11-03T20:00:00Z"), "America/New_York").getHours()).toBe(15);
  });
});

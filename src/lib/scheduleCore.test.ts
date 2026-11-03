import { describe, expect, it } from "vitest";
import { hotPlan } from "~/lib/schedule";
import { OFF } from "~/lib/presets";
import { currentCycle, decideStage, minutesSinceWake, needsPod, wallClock, type NightSchedule } from "~/lib/scheduleCore";

// Wall-clock moments (the tests run in UTC, like the server). Week of 2026-10-26:
// Mon 26, Tue 27, Wed 28, Thu 29, Fri 30, Sat 31, Sun Nov 1.
const at = (day: string, time: string) => new Date(`${day}T${time}:00Z`);
const TUE = "2026-10-27";
const WED = "2026-10-28";
const FRI = "2026-10-30";
const SAT = "2026-10-31";
const SUN = "2026-11-01";
const MON = "2026-11-02";

// In bed 23:00, wake 07:00: pre-cool 22:00, deep sleep 01:00, late sleep 05:00,
// Pre-wake 06:00 (+1), wake-up warmth 06:45 (+2). Levels in API units.
const base: NightSchedule = {
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
};

// Friday and Saturday nights: in bed 00:30, wake 09:00
const FRI_SAT = (1 << 5) | (1 << 6);
const weekend: NightSchedule = { ...base, weekendDays: FRI_SAT, weekendBedTime: "00:30", weekendWakeupTime: "09:00" };

const stageAt = (s: NightSchedule, day: string, time: string, plan?: NightSchedule) => {
  const d = decideStage(at(day, time), s, plan);
  return { stage: d.stage, level: d.level };
};

describe("a normal night", () => {
  it.each([
    [TUE, "12:00", "off", null],
    [TUE, "21:59", "off", null],
    [TUE, "22:00", "preheat", -20],
    [TUE, "22:59", "preheat", -20],
    [TUE, "23:00", "initial", -20],
    [WED, "00:59", "initial", -20],
    [WED, "01:00", "mid", -30],
    [WED, "04:59", "mid", -30],
    [WED, "05:00", "final", -10],
    [WED, "06:00", "prewake", 10],
    [WED, "06:44", "prewake", 10],
    [WED, "06:45", "alarm", 20],
    [WED, "06:59", "alarm", 20],
    [WED, "07:00", "off", null],
    [WED, "09:00", "off", null],
  ])("%s %s → %s", (day, time, stage, level) => {
    expect(stageAt(base, day, time)).toEqual({ stage, level });
  });

  it("outside the night, looks ahead to tonight", () => {
    expect(currentCycle(at(WED, "12:00"), base).preHeatingTime).toEqual(at(WED, "22:00"));
  });

  it("during the night, stays on the night that started yesterday evening", () => {
    const c = currentCycle(at(WED, "03:00"), base);
    expect(c.bedTime).toEqual(at(TUE, "23:00"));
    expect(c.wakeupTime).toEqual(at(WED, "07:00"));
  });

  it("with no pre-cool, turns on at bedtime", () => {
    const s = { ...base, preheatLeadMinutes: 0 };
    expect(stageAt(s, TUE, "22:59").stage).toBe("off");
    expect(stageAt(s, TUE, "23:00").stage).toBe("initial");
  });
});

describe("bedtime after midnight", () => {
  // in bed 00:30 (pre-cool 23:30 the evening before), wake 08:00
  const late: NightSchedule = { ...base, bedTime: "00:30", wakeupTime: "08:00", midStageSleepLevelStartTime: "02:00", finalSleepLevelStartTime: "06:00" };

  it.each([
    [TUE, "23:29", "off"],
    [TUE, "23:30", "preheat"],
    [WED, "00:29", "preheat"],
    [WED, "00:30", "initial"],
    [WED, "02:00", "mid"],
    [WED, "06:00", "final"],
    [WED, "07:00", "prewake"],
    [WED, "07:45", "alarm"],
    [WED, "08:00", "off"],
  ])("%s %s → %s", (day, time, stage) => {
    expect(stageAt(late, day, time).stage).toBe(stage);
  });

  it("counts as the night of the evening it starts", () => {
    // Tuesday night switched off: the 00:30 bedtime on Wednesday's date is still Tuesday's night
    const noTuesday = { ...late, activeDays: 127 & ~(1 << 2) };
    expect(decideStage(at(TUE, "23:45"), noTuesday).dayOff).toBe(true);
    expect(decideStage(at(WED, "01:00"), noTuesday).dayOff).toBe(true);
    // and switching Wednesday off leaves Tuesday's night alone
    const noWednesday = { ...late, activeDays: 127 & ~(1 << 3) };
    expect(stageAt(noWednesday, WED, "01:00").stage).toBe("initial");
  });

  it("a bedtime at midnight pre-cools from 23:30 the day before", () => {
    const midnight = { ...late, bedTime: "00:00", preheatLeadMinutes: 30 };
    expect(stageAt(midnight, TUE, "23:29").stage).toBe("off");
    expect(stageAt(midnight, TUE, "23:30").stage).toBe("preheat");
    expect(stageAt(midnight, WED, "00:00").stage).toBe("initial");
  });
});

describe("nights switched off", () => {
  const noTuesday: NightSchedule = { ...base, activeDays: 127 & ~(1 << 2) };

  it("Tuesday night is off, all the way to the morning", () => {
    for (const [day, time] of [[TUE, "22:30"], [WED, "02:00"], [WED, "06:50"]] as const) {
      const d = decideStage(at(day, time), noTuesday);
      expect(d.dayOff).toBe(true);
      expect(d.level).toBeNull();
    }
  });

  it("the nights around it still run", () => {
    expect(stageAt(noTuesday, "2026-10-26", "23:30").stage).toBe("initial");
    expect(stageAt(noTuesday, WED, "22:30").stage).toBe("preheat");
  });

  it("no nights at all: always off", () => {
    expect(decideStage(at(WED, "02:00"), { ...base, activeDays: 0 }).dayOff).toBe(true);
  });
});

describe("weekend nights (Friday and Saturday: in bed 00:30, wake 09:00)", () => {
  // deep sleep moves with bedtime (+1:30 → 02:30), late sleep with wake-up (+2:00 → 07:00)
  it.each([
    [FRI, "22:30", "off", null],
    [FRI, "23:30", "preheat", -20],
    [SAT, "01:00", "initial", -20],
    [SAT, "02:30", "mid", -30],
    [SAT, "07:00", "final", -10],
    [SAT, "08:00", "prewake", 10],
    [SAT, "08:45", "alarm", 20],
    [SAT, "09:00", "off", null],
    // Saturday night too, into Sunday morning
    [SAT, "23:30", "preheat", -20],
    [SUN, "07:30", "final", -10],
    [SUN, "09:00", "off", null],
  ])("%s %s → %s", (day, time, stage, level) => {
    expect(stageAt(weekend, day, time)).toEqual({ stage, level });
  });

  it("the weeknights keep the usual times", () => {
    expect(stageAt(weekend, "2026-10-29", "22:00").stage).toBe("preheat"); // Thursday
    expect(stageAt(weekend, FRI, "07:00").stage).toBe("off"); // Thursday night ends at 07:00
    expect(stageAt(weekend, SUN, "22:00").stage).toBe("preheat"); // Sunday is a weeknight
    expect(stageAt(weekend, MON, "07:00").stage).toBe("off");
  });
});

describe("Pre-wake and the wake-up warmth", () => {
  it("wake-up 8:00 with Pre-wake 1 hour: Pre-wake 7:00–7:45, warmth 7:45–8:00", () => {
    const s = { ...base, wakeupTime: "08:00", finalSleepLevelStartTime: "06:00" };
    expect(stageAt(s, WED, "06:59").stage).toBe("final");
    expect(stageAt(s, WED, "07:00").stage).toBe("prewake");
    expect(stageAt(s, WED, "07:45").stage).toBe("alarm");
    expect(stageAt(s, WED, "08:00").stage).toBe("off");
  });

  it("Pre-wake 3 hours before a 07:00 wake-up starts at 04:00, ahead of the stages it overlaps", () => {
    const s = { ...base, preWakeLeadMinutes: 180 };
    expect(stageAt(s, WED, "03:59")).toEqual({ stage: "mid", level: -30 });
    expect(stageAt(s, WED, "04:00")).toEqual({ stage: "prewake", level: 10 });
    expect(stageAt(s, WED, "05:30")).toEqual({ stage: "prewake", level: 10 });
    expect(stageAt(s, WED, "06:45")).toEqual({ stage: "alarm", level: 20 });
  });

  it("Pre-wake off: late sleep runs until the warmth", () => {
    const s = { ...base, preWakeEnabled: false };
    expect(stageAt(s, WED, "06:30")).toEqual({ stage: "final", level: -10 });
    expect(stageAt(s, WED, "06:45").stage).toBe("alarm");
  });

  it("Pre-wake no longer than the warmth: it drops out", () => {
    const s = { ...base, preWakeLeadMinutes: 15 };
    expect(stageAt(s, WED, "06:44").stage).toBe("final");
    expect(stageAt(s, WED, "06:45").stage).toBe("alarm");
  });

  it("warmth off: Pre-wake runs until wake-up", () => {
    const s = { ...base, wakeupAlarmEnabled: false };
    expect(stageAt(s, WED, "06:59")).toEqual({ stage: "prewake", level: 10 });
    expect(stageAt(s, WED, "07:00").stage).toBe("off");
  });

  it("Pre-wake never starts before bedtime", () => {
    // a short night: Pre-wake 3 hours before a 01:30 wake-up would start at 22:30, in pre-cool
    const s = { ...base, wakeupTime: "01:30", preWakeLeadMinutes: 180, wakeupAlarmEnabled: false };
    expect(stageAt(s, TUE, "22:45").stage).toBe("preheat");
    expect(stageAt(s, TUE, "23:10").stage).toBe("prewake");
  });

  it("missing values fall back: Pre-wake at +1, warmth 30 minutes", () => {
    const s = { ...base, preWakeLevel: null, wakeupAlarmLeadMinutes: null };
    expect(stageAt(s, WED, "06:15")).toEqual({ stage: "prewake", level: 10 });
    expect(stageAt(s, WED, "06:30")).toEqual({ stage: "alarm", level: 20 });
  });
});

describe("hot nights", () => {
  const hot = hotPlan(base);

  it("start cooling 30 minutes earlier and one step colder", () => {
    expect(stageAt(base, TUE, "21:29", hot).stage).toBe("off");
    expect(stageAt(base, TUE, "21:30", hot)).toEqual({ stage: "preheat", level: -30 });
    expect(stageAt(base, TUE, "23:30", hot)).toEqual({ stage: "initial", level: -30 });
  });

  it("leave the rest of the night as it was", () => {
    expect(stageAt(base, WED, "01:00", hot)).toEqual({ stage: "mid", level: -30 });
    expect(stageAt(base, WED, "05:00", hot)).toEqual({ stage: "final", level: -10 });
    expect(stageAt(base, WED, "06:45", hot)).toEqual({ stage: "alarm", level: 20 });
    expect(stageAt(base, WED, "07:00", hot).stage).toBe("off");
  });

  it("never go below the coldest level", () => {
    expect(hotPlan({ ...base, initialSleepLevel: -100 }).initialSleepLevel).toBe(-100);
  });
});

describe("stages set to Off", () => {
  const off = (bits: number): NightSchedule => ({ ...base, offStages: bits });

  it("deep sleep Off: the bed is off from 01:00, back on for late sleep", () => {
    const s = off(OFF.mid);
    expect(stageAt(s, WED, "00:59")).toEqual({ stage: "initial", level: -20 });
    expect(stageAt(s, WED, "01:00")).toEqual({ stage: "mid", level: null });
    expect(stageAt(s, WED, "04:59")).toEqual({ stage: "mid", level: null });
    expect(stageAt(s, WED, "05:00")).toEqual({ stage: "final", level: -10 });
  });

  it("falling asleep Off: pre-cool is off too, the bed starts at deep sleep", () => {
    const s = off(OFF.initial);
    expect(stageAt(s, TUE, "22:00")).toEqual({ stage: "preheat", level: null });
    expect(stageAt(s, TUE, "23:30")).toEqual({ stage: "initial", level: null });
    expect(stageAt(s, WED, "01:00")).toEqual({ stage: "mid", level: -30 });
  });

  it("late sleep Off: off until Pre-wake", () => {
    const s = off(OFF.final);
    expect(stageAt(s, WED, "05:00")).toEqual({ stage: "final", level: null });
    expect(stageAt(s, WED, "06:00")).toEqual({ stage: "prewake", level: 10 });
  });

  it("Pre-wake Off: off during Pre-wake, then the warmth turns it back on", () => {
    const s = off(OFF.prewake);
    expect(stageAt(s, WED, "05:59")).toEqual({ stage: "final", level: -10 });
    expect(stageAt(s, WED, "06:00")).toEqual({ stage: "prewake", level: null });
    expect(stageAt(s, WED, "06:45")).toEqual({ stage: "alarm", level: 20 });
  });

  it("Pre-wake's own switch off still means late sleep runs on (not bed off)", () => {
    const s = { ...base, preWakeEnabled: false, offStages: OFF.prewake };
    expect(stageAt(s, WED, "06:30")).toEqual({ stage: "final", level: -10 });
  });

  it("two in a row, and all four", () => {
    expect(stageAt(off(OFF.mid | OFF.final), WED, "03:00").level).toBeNull();
    expect(stageAt(off(OFF.mid | OFF.final), WED, "05:30").level).toBeNull();
    const all = off(OFF.initial | OFF.mid | OFF.final | OFF.prewake);
    for (const t of ["22:30", "23:30"]) expect(stageAt(all, TUE, t).level).toBeNull();
    for (const t of ["02:00", "05:30", "06:10"]) expect(stageAt(all, WED, t).level).toBeNull();
    expect(stageAt(all, WED, "06:45")).toEqual({ stage: "alarm", level: 20 });
  });

  it("a hot night doesn't bring back a falling-asleep stage that's Off", () => {
    const s = off(OFF.initial);
    expect(stageAt(s, TUE, "21:30", hotPlan(s))).toEqual({ stage: "preheat", level: null });
  });

  it("weekend nights keep the Off stages", () => {
    const s = { ...weekend, offStages: OFF.mid };
    expect(stageAt(s, SAT, "03:00")).toEqual({ stage: "mid", level: null });
  });

  it("the check still looks at the Pod during an Off stage, to turn it off", () => {
    const s = off(OFF.mid);
    const now = at(WED, "02:00");
    expect(needsPod(now, s, decideStage(now, s))).toBe(true);
  });
});

describe("odd schedules the check straightens out", () => {
  it("deep sleep set after wake-up starts an hour after bedtime", () => {
    const s = { ...base, midStageSleepLevelStartTime: "08:00" };
    expect(stageAt(s, TUE, "23:59").stage).toBe("initial");
    expect(stageAt(s, WED, "00:00").stage).toBe("mid");
  });

  it("late sleep set before deep sleep starts an hour before wake-up", () => {
    const s = { ...base, finalSleepLevelStartTime: "00:30", preWakeEnabled: false, wakeupAlarmEnabled: false };
    expect(stageAt(s, WED, "05:59").stage).toBe("mid");
    expect(stageAt(s, WED, "06:00").stage).toBe("final");
  });

  it("times saved with seconds still work", () => {
    const s = { ...base, bedTime: "23:00:00.000000", wakeupTime: "07:00:00.000000" };
    expect(stageAt(s, TUE, "22:00").stage).toBe("preheat");
    expect(stageAt(s, WED, "07:00").stage).toBe("off");
  });
});

describe("after wake-up", () => {
  it("counts minutes from that night's own wake-up", () => {
    expect(minutesSinceWake(at(WED, "07:05"), base)).toBe(5);
    expect(minutesSinceWake(at(SAT, "09:05"), weekend)).toBe(5);
    expect(minutesSinceWake(at(SUN, "10:00"), weekend)).toBe(60);
  });

  it("keeps checking the Pod for an hour after wake-up, then leaves it alone", () => {
    const check = (s: NightSchedule, day: string, time: string) => needsPod(at(day, time), s, decideStage(at(day, time), s));
    expect(check(base, WED, "03:00")).toBe(true);
    expect(check(base, WED, "07:30")).toBe(true);
    expect(check(base, WED, "08:00")).toBe(false);
    expect(check(base, WED, "15:00")).toBe(false);
  });

  it("on a weekend night, turns the bed off at the weekend wake-up", () => {
    const check = (day: string, time: string) => needsPod(at(day, time), weekend, decideStage(at(day, time), weekend));
    expect(check(SAT, "09:05")).toBe(true);
    expect(check(SAT, "09:55")).toBe(true);
    expect(check(SAT, "10:00")).toBe(false);
  });
});

describe("clock changes (New York)", () => {
  const NY = "America/New_York";
  const stageNY = (utc: string) => decideStage(wallClock(new Date(utc), NY), base).stage;

  it("clocks go back on Sunday Nov 1: 1:30 happens twice and both are deep sleep", () => {
    expect(wallClock(new Date("2026-11-01T05:30:00Z"), NY)).toEqual(at(SUN, "01:30")); // 1:30 EDT
    expect(wallClock(new Date("2026-11-01T06:30:00Z"), NY)).toEqual(at(SUN, "01:30")); // 1:30 EST
    expect(stageNY("2026-11-01T05:30:00Z")).toBe("mid");
    expect(stageNY("2026-11-01T06:30:00Z")).toBe("mid");
  });

  it("the morning after still runs by the wall clock", () => {
    expect(stageNY("2026-11-01T11:00:00Z")).toBe("prewake"); // 6:00 EST
    expect(stageNY("2026-11-01T11:45:00Z")).toBe("alarm"); // 6:45 EST
    expect(stageNY("2026-11-01T12:00:00Z")).toBe("off"); // 7:00 EST
  });

  it("clocks go forward in March: 2:00 to 3:00 is skipped, the night carries on", () => {
    expect(wallClock(new Date("2027-03-14T07:30:00Z"), NY)).toEqual(at("2027-03-14", "03:30"));
    expect(stageNY("2027-03-14T07:30:00Z")).toBe("mid");
    expect(stageNY("2027-03-14T10:00:00Z")).toBe("prewake"); // 6:00 EDT
  });
});

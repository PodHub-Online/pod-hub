import { describe, expect, it } from "vitest";
import { gapMinutes, gapText, isValidZone, toDeviceHHMM, toDeviceMinutes, wallToInstant, zoneLabel, zoneOffsetMinutes } from "~/lib/scheduleTime";

const BEFORE = new Date("2026-10-28T12:00:00Z"); // US clocks still on summer time
const AFTER = new Date("2026-11-03T12:00:00Z"); // after they went back on 1 Nov

describe("zone offsets", () => {
  it("New York: -4 h in summer time, -5 h after 1 Nov", () => {
    expect(zoneOffsetMinutes("America/New_York", BEFORE)).toBe(-240);
    expect(zoneOffsetMinutes("America/New_York", AFTER)).toBe(-300);
  });
  it("Santo Domingo never changes (-4 h)", () => {
    expect(zoneOffsetMinutes("America/Santo_Domingo", BEFORE)).toBe(-240);
    expect(zoneOffsetMinutes("America/Santo_Domingo", AFTER)).toBe(-240);
  });
  it("half-hour zones", () => {
    expect(zoneOffsetMinutes("Asia/Kolkata", AFTER)).toBe(330);
  });
});

describe("gap between the schedule's clock and the phone's", () => {
  it("the same zone → 0", () => {
    expect(gapMinutes("America/New_York", "America/New_York", AFTER)).toBe(0);
  });
  it("New York schedule on a Santo Domingo phone: right in October, 1 h BEHIND after the US clocks changed", () => {
    expect(gapMinutes("America/New_York", "America/Santo_Domingo", BEFORE)).toBe(0);
    expect(gapMinutes("America/New_York", "America/Santo_Domingo", AFTER)).toBe(-60);
  });
  it("a schedule ahead of the phone is positive", () => {
    expect(gapMinutes("America/New_York", "America/Chicago", AFTER)).toBe(60);
  });
  it("unknown or empty zones count as no gap", () => {
    expect(gapMinutes("Not/AZone", "America/New_York", AFTER)).toBe(0);
    expect(gapMinutes(null, "America/New_York", AFTER)).toBe(0);
  });
});

describe("showing a schedule time on the phone's clock", () => {
  it("a schedule 1 h behind: 4:00 PM in the schedule is 5:00 PM on the phone", () => {
    expect(toDeviceHHMM("16:00", -60)).toBe("17:00");
    expect(toDeviceMinutes(16 * 60, -60)).toBe(17 * 60);
  });
  it("a schedule ahead: 4:00 PM in the schedule is 3:00 PM on the phone", () => {
    expect(toDeviceHHMM("16:00:00", 60)).toBe("15:00");
  });
  it("wraps around midnight", () => {
    expect(toDeviceHHMM("23:30", -60)).toBe("00:30");
    expect(toDeviceHHMM("00:30", 60)).toBe("23:30");
  });
  it("no gap changes nothing", () => {
    expect(toDeviceHHMM("22:30", 0)).toBe("22:30");
  });
});

describe("wall clock to a real moment", () => {
  it("adds the time between 'now on the schedule's clock' and the wall time", () => {
    const now = new Date("2026-11-03T20:00:00Z");
    const wallNow = new Date(2026, 10, 3, 15, 0); // 3:00 PM on the schedule's clock
    const wall = new Date(2026, 10, 3, 16, 30); // 4:30 PM
    expect(wallToInstant(wall, wallNow, now).toISOString()).toBe("2026-11-03T21:30:00.000Z");
  });
});

describe("labels", () => {
  it("city and abbreviation", () => {
    expect(zoneLabel("America/New_York", AFTER)).toEqual({ city: "New York", abbrev: "EST" });
    expect(zoneLabel("America/Argentina/Buenos_Aires", AFTER).city).toBe("Buenos Aires");
  });
  it("gap text", () => {
    expect(gapText(-60)).toEqual({ hours: 1, minutes: 0 });
    expect(gapText(90)).toEqual({ hours: 1, minutes: 30 });
  });
  it("zone validity", () => {
    expect(isValidZone("America/New_York")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
  });
});

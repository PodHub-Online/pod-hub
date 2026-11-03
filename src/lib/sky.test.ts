import { describe, expect, it } from "vitest";
import { computeSky, conditionFromCode, extremeFor, moonName, moonPhase, skyNumberC } from "~/lib/sky";

const d = (s: string) => new Date(s);
const sun = {
  rise: [d("2026-11-02T11:30:00Z"), d("2026-11-03T11:31:00Z"), d("2026-11-04T11:32:00Z")],
  set: [d("2026-11-02T22:40:00Z"), d("2026-11-03T22:39:00Z"), d("2026-11-04T22:38:00Z")],
};
const base = { sun, code: 0, tempC: 20, lowC: 14, rainPct: null };

describe("weather codes", () => {
  it("maps the forecast to a sky", () => {
    expect(conditionFromCode(0)).toBe("clear");
    expect(conditionFromCode(2)).toBe("partly");
    expect(conditionFromCode(3)).toBe("cloudy");
    expect(conditionFromCode(45)).toBe("fog");
    expect(conditionFromCode(63)).toBe("rain");
    expect(conditionFromCode(81)).toBe("rain");
    expect(conditionFromCode(73)).toBe("snow");
    expect(conditionFromCode(95)).toBe("thunder");
    expect(conditionFromCode(null)).toBe("clear");
  });
  it("hot and very cold", () => {
    expect(extremeFor(36)).toBe("hot");
    expect(extremeFor(-10)).toBe("cold");
    expect(extremeFor(20)).toBeNull();
  });
});

describe("moon", () => {
  it("is new on a known new moon and full about two weeks later", () => {
    expect(moonName(moonPhase(d("2026-11-09T22:02:00Z")))).toBe("New moon"); // new moon 9 Nov 2026
    expect(moonName(moonPhase(d("2026-11-24T14:00:00Z")))).toBe("Full moon"); // full moon 24 Nov 2026
  });
  it("always between 0 and 1", () => {
    for (let i = 0; i < 60; i++) {
      const f = moonPhase(new Date(Date.UTC(2026, 0, 1 + i)));
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe("time of day", () => {
  it("noon is day with the sun halfway", () => {
    const s = computeSky({ ...base, now: d("2026-11-03T17:00:00Z") });
    expect(s).toMatchObject({ phase: "day", body: "sun" });
    expect(s.progress).toBeGreaterThan(0.4);
    expect(s.progress).toBeLessThan(0.6);
  });
  it("just after sunrise is dawn, just before sunset is dusk", () => {
    expect(computeSky({ ...base, now: d("2026-11-03T11:50:00Z") }).phase).toBe("dawn");
    expect(computeSky({ ...base, now: d("2026-11-03T22:20:00Z") }).phase).toBe("dusk");
  });
  it("after dark it is night with the moon, moving across until sunrise", () => {
    const early = computeSky({ ...base, now: d("2026-11-04T01:00:00Z") });
    const late = computeSky({ ...base, now: d("2026-11-04T10:00:00Z") });
    expect(early).toMatchObject({ phase: "night", body: "moon" });
    expect(late.progress).toBeGreaterThan(early.progress);
  });
  it("without sun times it still knows day from night on the phone's clock", () => {
    const noon = computeSky({ now: new Date(2026, 10, 3, 12, 0), sun: null, code: null, tempC: null, lowC: null, rainPct: null });
    const midnight = computeSky({ now: new Date(2026, 10, 3, 1, 0), sun: null, code: null, tempC: null, lowC: null, rainPct: null });
    expect(noon.phase).toBe("day");
    expect(midnight.phase).toBe("night");
    expect(noon.hasWeather).toBe(false);
  });
});

describe("the number", () => {
  it("now by day, tonight's low at night", () => {
    expect(skyNumberC(computeSky({ ...base, now: d("2026-11-03T17:00:00Z") }))).toBe(20);
    expect(skyNumberC(computeSky({ ...base, now: d("2026-11-04T02:00:00Z") }))).toBe(14);
  });
});

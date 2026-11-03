import { describe, expect, it } from "vitest";
import { degreeSteps, displayDegrees, rawToDegrees, stepDegree, stepLevel } from "~/lib/bedTemp";

describe("levels to degrees", () => {
  it.each([
    [-100, 55, 13],
    [-50, 70, 21],
    [-40, 72, 22],
    [0, 81, 27],
    [50, 97, 36],
    [100, 110, 43], // shown within Eight Sleep's published range
  ])("raw %i → %i°F / %i°C", (raw, f, c) => {
    expect(displayDegrees(raw, "f")).toBe(f);
    expect(displayDegrees(raw, "c")).toBe(c);
  });

  it("cooling levels use their nearest table entries (not the two ends of the table)", () => {
    expect(rawToDegrees(-49, "f")).toBe(70);
    expect(rawToDegrees(-54, "f")).toBe(69);
  });
});

describe("one-degree steps", () => {
  it("offers every whole degree, 55–110°F and 13–43°C", () => {
    const f = degreeSteps("f").map((s) => s.deg);
    const c = degreeSteps("c").map((s) => s.deg);
    expect(f).toEqual(Array.from({ length: 56 }, (_, i) => 55 + i));
    expect(c).toEqual(Array.from({ length: 31 }, (_, i) => 13 + i));
  });

  it("each step's level shows as that very degree", () => {
    for (const unit of ["f", "c"] as const) {
      for (const s of degreeSteps(unit)) expect(displayDegrees(s.raw, unit)).toBe(s.deg);
    }
  });

  it("the warmest step sends the Pod's real maximum", () => {
    expect(degreeSteps("f").at(-1)).toEqual({ deg: 110, raw: 100 });
    expect(degreeSteps("c").at(-1)).toEqual({ deg: 43, raw: 100 });
  });

  it("+ and − move exactly one degree", () => {
    expect(displayDegrees(stepDegree(-100, "f", 1), "f")).toBe(56);
    expect(displayDegrees(stepDegree(-50, "f", 1), "f")).toBe(71);
    expect(displayDegrees(stepDegree(-50, "f", -1), "f")).toBe(69);
    expect(displayDegrees(stepDegree(-100, "c", 1), "c")).toBe(14);
    expect(displayDegrees(stepDegree(0, "c", -1), "c")).toBe(26);
  });

  it("stops at the ends", () => {
    expect(stepDegree(-100, "f", -1)).toBe(-100);
    expect(stepDegree(100, "f", 1)).toBe(100);
    expect(stepDegree(100, "c", 1)).toBe(100);
  });

  it("walks the whole range in °F without skipping or repeating", () => {
    let raw = -100;
    const seen = [displayDegrees(raw, "f")];
    for (let i = 0; i < 60; i++) {
      const next = stepDegree(raw, "f", 1);
      if (next === raw) break;
      raw = next;
      seen.push(displayDegrees(raw, "f"));
    }
    expect(seen).toEqual(Array.from({ length: 56 }, (_, i) => 55 + i));
  });
});

describe("level steps", () => {
  it("move one level and land on whole levels", () => {
    expect(stepLevel(-50, 1)).toBe(-40);
    expect(stepLevel(-50, -1)).toBe(-60);
    expect(stepLevel(-49, -1)).toBe(-50); // a degree setting snaps to the next whole level
    expect(stepLevel(-49, 1)).toBe(-40);
    expect(stepLevel(100, 1)).toBe(100);
    expect(stepLevel(-100, -1)).toBe(-100);
  });
});

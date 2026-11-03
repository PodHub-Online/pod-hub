import { describe, expect, it } from "vitest";
import { bestCombo, bestForStage, bestNight, historyCsv, type HistNight } from "~/lib/tempHistory";

const n = (night: string, i: number | null, m: number | null, f: number | null, result: number | null): HistNight => ({ night, stages: { initial: i, mid: m, final: f }, result });

describe("what worked best", () => {
  const nights = [
    n("2026-10-28", -4, -6, -2, 90),
    n("2026-10-29", -4, -6, -2, 92),
    n("2026-10-30", -4, -6, -2, 88),
    n("2026-10-31", -2, -5, -2, 70),
    n("2026-11-01", -2, -5, -2, 75),
    n("2026-11-02", -2, -5, 0, 80),
  ];
  it("needs 3 nights at a temperature before it counts", () => {
    expect(bestForStage(nights, "initial")).toEqual({ level: -4, avg: 90, nights: 3 });
    // -5 has 3 nights at 75 avg; -6 has 3 nights at 90 → -6 wins
    expect(bestForStage(nights, "mid")).toMatchObject({ level: -6, nights: 3 });
    // a temperature seen twice never wins
    expect(bestForStage(nights.slice(0, 2), "initial")).toBeNull();
  });
  it("finds the best combination of all three", () => {
    expect(bestCombo(nights)).toEqual({ levels: { initial: -4, mid: -6, final: -2 }, avg: 90, nights: 3 });
  });
  it("ignores nights with no result or an off stage when comparing", () => {
    const withGaps = [...nights, n("2026-11-03", -4, null, -2, 100), n("2026-11-04", -4, -6, -2, null)];
    expect(bestCombo(withGaps)?.nights).toBe(3);
    expect(bestForStage(withGaps, "initial")?.nights).toBe(4); // the night with deep off still counts for falling asleep
  });
  it("marks the best night", () => expect(bestNight(nights)).toBe("2026-10-29"));
  it("is empty without enough data", () => {
    expect(bestForStage([], "mid")).toBeNull();
    expect(bestCombo([])).toBeNull();
  });
});

describe("csv", () => {
  it("writes steps, off and the result", () => {
    expect(historyCsv([n("2026-10-28", -4, null, -2, 90.4)], "sleep_score")).toBe("night,falling_asleep,deep_sleep,late_sleep,sleep_score\n2026-10-28,-4,off,-2,90\n");
  });
});

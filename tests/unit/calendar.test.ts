import { describe, expect, it } from "vitest";
import { layoutCalendar, PITCH, weekdayOf } from "@/lib/calendar";
import type { ContributionCalendar, ContributionDay } from "@/data/types";

function week(start: string, counts: number[]): ContributionDay[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return counts.map((count, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    count,
    level: (count === 0 ? 0 : Math.min(4, count)) as ContributionDay["level"],
  }));
}

/** `count` all-zero weeks starting on a Sunday. */
function quiet(start: string, count: number): ContributionDay[][] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => week(new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10), [0, 0, 0, 0, 0, 0, 0]));
}

describe("layoutCalendar", () => {
  // 2026-01-04 is a Sunday.
  const calendar: ContributionCalendar = {
    total: 9,
    from: "2026-01-04",
    to: "2026-02-07",
    weeks: [
      week("2026-01-04", [0, 1, 0, 0, 5, 0, 0]),
      week("2026-01-11", [0, 0, 0, 0, 0, 0, 0]),
      week("2026-01-18", [0, 0, 0, 0, 0, 0, 0]),
      week("2026-01-25", [0, 0, 0, 0, 0, 0, 0]),
      week("2026-02-01", [0, 0, 3, 0, 0, 0, 0]),
    ],
  };

  it("places days by weekday row and week column", () => {
    const layout = layoutCalendar(calendar);
    expect(weekdayOf("2026-01-04")).toBe(0);
    const day = layout.days.find((d) => d.date === "2026-01-08");
    expect(day).toMatchObject({ row: 4, col: 0, count: 5 });
    expect(layout.days).toHaveLength(35);
    expect(layout.width).toBe(5 * PITCH - 3);
  });

  it("handles partial first and last weeks using real weekdays", () => {
    const partial: ContributionCalendar = { ...calendar, weeks: [week("2026-01-07", [1, 1, 1, 1]), week("2026-01-11", [2, 2])] };
    const layout = layoutCalendar(partial);
    expect(layout.days[0]).toMatchObject({ date: "2026-01-07", row: 3, col: 0 });
    expect(layout.days.at(-1)).toMatchObject({ date: "2026-01-12", row: 1, col: 1 });
  });

  it("labels month starts without collisions and reports derived stats from real data", () => {
    const layout = layoutCalendar({ ...calendar, weeks: [...calendar.weeks, ...quiet("2026-02-08", 3)] });
    expect(layout.months.map((m) => [m.col, m.date.slice(0, 7)])).toEqual([
      [0, "2026-01"],
      [4, "2026-02"],
    ]);
    expect(layout.activeDays).toBe(3);
    expect(layout.busiest).toMatchObject({ date: "2026-01-08", count: 5 });
  });

  it("drops a leading label that would collide with the next month", () => {
    const tight: ContributionCalendar = { ...calendar, weeks: quiet("2026-01-25", 6) };
    expect(layoutCalendar(tight).months.map((m) => [m.col, m.date.slice(0, 7)])).toEqual([[1, "2026-02"]]);
  });

  it("drops a label too close to the right edge to fit", () => {
    // Feb starts in the second-to-last column, where "feb" would overflow the grid.
    const edge: ContributionCalendar = { ...calendar, weeks: quiet("2026-01-18", 4) };
    expect(layoutCalendar(edge).months.map((m) => m.date.slice(0, 7))).toEqual(["2026-01"]);
  });

  it("copes with an all-quiet calendar", () => {
    const quiet = layoutCalendar({ ...calendar, weeks: [week("2026-01-04", [0, 0, 0, 0, 0, 0, 0])] });
    expect(quiet.busiest).toBeNull();
    expect(quiet.activeDays).toBe(0);
  });
});

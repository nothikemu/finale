import { describe, expect, it } from "vitest";
import { parsePublicCalendar } from "@/data/github/public-calendar";

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Cell {
  date: string;
  count: number;
}

/** A year of days ending on `end` (UTC), counts from a deterministic pattern. */
function year(end = "2026-10-18"): Cell[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: 365 }, (_, i) => {
    const date = new Date(last - (364 - i) * DAY).toISOString().slice(0, 10);
    return { date, count: i % 7 === 0 ? 0 : (i * 5) % 17 };
  });
}

const levelOf = (count: number) => (count === 0 ? 0 : count < 4 ? 1 : count < 8 ? 2 : count < 12 ? 3 : 4);
const tip = (count: number, date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  const when = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}th`;
  return count === 0 ? `No contributions on ${when}.` : `${count.toLocaleString("en-US")} contribution${count === 1 ? "" : "s"} on ${when}.`;
};

/** GitHub's current markup: a <tr> per weekday of <td data-date data-level id>, tooltips afterwards. */
function html(cells: Cell[], options: { shuffleAttributes?: boolean; dropTooltips?: boolean } = {}): string {
  const tds = cells.map((c, i) => {
    const attrs = [`data-date="${c.date}"`, `id="contribution-day-component-${i % 7}-${Math.floor(i / 7)}"`, `data-level="${levelOf(c.count)}"`, 'class="ContributionCalendar-day"'];
    if (options.shuffleAttributes) attrs.reverse();
    return `<td tabindex="-1" ${attrs.join(" ")} role="gridcell"></td>`;
  });
  const tips = options.dropTooltips
    ? ""
    : cells.map((c, i) => `<tool-tip id="tooltip-${i}" for="contribution-day-component-${i % 7}-${Math.floor(i / 7)}" popover="manual" class="sr-only">${tip(c.count, c.date)}</tool-tip>`).join("");
  return `<div><h2>x contributions in the last year</h2><table><tbody><tr>${tds.join("")}</tr></tbody></table>${tips}</div>`;
}

describe("parsePublicCalendar", () => {
  it("reads every day, its level and count, and the real range and total", () => {
    const cells = year();
    const calendar = parsePublicCalendar(html(cells));
    expect(calendar.from).toBe(cells[0]!.date);
    expect(calendar.to).toBe("2026-10-18");
    expect(calendar.total).toBe(cells.reduce((sum, c) => sum + c.count, 0));
    expect(calendar.weeks.flat()).toHaveLength(365);
    const sample = calendar.weeks.flat().find((d) => d.date === cells[100]!.date)!;
    expect(sample).toMatchObject({ count: cells[100]!.count, level: levelOf(cells[100]!.count) });
  });

  it("groups days into Sunday-first weeks regardless of cell order in the markup", () => {
    const cells = year();
    const scrambled = [...cells].sort((a, b) => (a.date.slice(-1) < b.date.slice(-1) ? 1 : -1));
    const calendar = parsePublicCalendar(html(scrambled));
    for (const week of calendar.weeks.slice(1, -1)) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    }
    const flat = calendar.weeks.flat().map((d) => d.date);
    expect(flat).toEqual([...flat].sort());
  });

  it("does not depend on attribute order and understands thousands separators", () => {
    const cells = year();
    cells[10] = { date: cells[10]!.date, count: 1234 };
    const calendar = parsePublicCalendar(html(cells, { shuffleAttributes: true }));
    expect(calendar.weeks.flat().find((d) => d.date === cells[10]!.date)!.count).toBe(1234);
  });

  it("understands the older SVG markup with data-count", () => {
    const cells = year();
    const svg = cells.map((c) => `<rect class="ContributionCalendar-day" data-count="${c.count}" data-date="${c.date}" data-level="${levelOf(c.count)}"></rect>`).join("");
    const calendar = parsePublicCalendar(`<svg>${svg}</svg>`);
    expect(calendar.total).toBe(cells.reduce((sum, c) => sum + c.count, 0));
  });

  it("fails closed rather than guessing", () => {
    expect(() => parsePublicCalendar("<html>sign in to continue</html>")).toThrow(/invalid-response/);
    expect(() => parsePublicCalendar(html(year().slice(0, 40)))).toThrow(/invalid-response/); // too few days
    expect(() => parsePublicCalendar(html(year(), { dropTooltips: true }))).toThrow(/invalid-response/); // levels without counts
    const badLevel = html(year()).replace('data-level="2"', 'data-level="9"');
    expect(() => parsePublicCalendar(badLevel)).toThrow(/invalid-response/);
  });

  it("ignores cells with impossible dates", () => {
    const withJunk = html(year()) + '<td data-date="2026-13-45" data-level="1"></td><td data-date="not-a-date" data-level="1"></td>';
    expect(parsePublicCalendar(withJunk).weeks.flat()).toHaveLength(365);
  });
});

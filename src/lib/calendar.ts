import type { ContributionCalendar, ContributionDay } from "@/data/types";

/** Geometry shared by the SVG and the HTML labels positioned over it. */
export const CELL = 12;
export const GAP = 3;
export const PITCH = CELL + GAP;
export const ROWS = 7;
/** Months closer together than this many columns would collide, so the earlier label is dropped. */
const MIN_LABEL_SPACING = 3;

export interface PlacedDay extends ContributionDay {
  /** Weekday row, 0 = Sunday. */
  row: number;
  col: number;
}

export interface MonthLabel {
  col: number;
  /** YYYY-MM-DD of the first day in that column; formatted by the caller. */
  date: string;
}

export interface CalendarLayout {
  days: PlacedDay[];
  weekCount: number;
  width: number;
  height: number;
  months: MonthLabel[];
  activeDays: number;
  busiest: ContributionDay | null;
}

export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function layoutCalendar(calendar: ContributionCalendar): CalendarLayout {
  const weekCount = calendar.weeks.length;
  const days: PlacedDay[] = [];
  let activeDays = 0;
  let busiest: ContributionDay | null = null;

  calendar.weeks.forEach((week, col) => {
    for (const day of week) {
      days.push({ ...day, row: weekdayOf(day.date), col });
      if (day.count > 0) activeDays += 1;
      if (day.count > 0 && (!busiest || day.count > busiest.count)) busiest = day;
    }
  });

  // A month label sits on the first column that starts in a new month.
  const candidates: MonthLabel[] = [];
  let previousMonth = "";
  calendar.weeks.forEach((week, col) => {
    const first = week[0];
    if (!first) return;
    const month = first.date.slice(0, 7);
    if (month !== previousMonth) candidates.push({ col, date: first.date });
    previousMonth = month;
  });
  // Labels that would run past the right edge go first, so a doomed label
  // cannot cause its neighbour to be dropped; then resolve collisions.
  const fitting = candidates.filter((label) => weekCount - label.col >= MIN_LABEL_SPACING);
  const months = fitting.filter((label, i) => {
    const next = fitting[i + 1];
    return !next || next.col - label.col >= MIN_LABEL_SPACING;
  });

  return {
    days,
    weekCount,
    width: weekCount * PITCH - GAP,
    height: ROWS * PITCH - GAP,
    months,
    activeDays,
    busiest,
  };
}

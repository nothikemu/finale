import { Suspense } from "react";
import { site } from "@/config/site";
import { loadContributions } from "@/data/github/contributions";
import type { ContributionCalendar } from "@/data/types";
import { CELL, layoutCalendar, PITCH, ROWS } from "@/lib/calendar";
import { formatCalendarDate, formatCount, formatMonth, pluralize } from "@/lib/format";
import { CalendarInteractive } from "./CalendarInteractive";
import { Panel, StateMessage, devHint } from "./Panel";

const WEEKDAY_LABELS = [
  { row: 1, text: "mon" },
  { row: 3, text: "wed" },
  { row: 5, text: "fri" },
];

export function ContributionCalendarPanel() {
  return (
    <Panel id="activity" index={4} title="github activity">
      <Suspense fallback={<div className="calendar-skeleton skeleton" aria-hidden="true" />}>
        <CalendarContent />
      </Suspense>
    </Panel>
  );
}

async function CalendarContent() {
  const result = await loadContributions(site.githubUsername);

  if (result.status === "missing-config") {
    return <StateMessage hint={devHint(`set ${result.missing.join(", ")} (see README)`)}>github activity unavailable</StateMessage>;
  }
  if (result.status === "unavailable") {
    return <StateMessage>github activity unavailable</StateMessage>;
  }
  return <Calendar calendar={result.data} stale={result.stale} />;
}

function cellLabel(count: number, date: string): string {
  return `${count === 0 ? "no contributions" : pluralize(count, "contribution")} on ${formatCalendarDate(date, "long")}`;
}

function Calendar({ calendar, stale }: { calendar: ContributionCalendar; stale: boolean }) {
  const layout = layoutCalendar(calendar);
  const { width, height, weekCount } = layout;
  const range = `${formatCalendarDate(calendar.from)} to ${formatCalendarDate(calendar.to)}`;

  // The most recent day is the grid's single tab stop; arrow keys move from there.
  const latest = layout.days.reduce((a, b) => (b.date > a.date ? b : a), layout.days[0]!);

  const summary = [
    `${pluralize(calendar.total, "contribution")} from ${range}.`,
    `${pluralize(layout.activeDays, "day")} with activity.`,
    layout.busiest ? `busiest day ${formatCalendarDate(layout.busiest.date, "long")} with ${pluralize(layout.busiest.count, "contribution")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="calendar">
      <div className="calendar__summary">
        <p className="calendar__total">
          <span className="calendar__number">{formatCount(calendar.total)}</span> contributions
        </p>
        <p className="calendar__range">
          <time dateTime={calendar.from}>{formatCalendarDate(calendar.from)}</time>
          <span aria-hidden="true"> – </span>
          <span className="visually-hidden"> to </span>
          <time dateTime={calendar.to}>{formatCalendarDate(calendar.to)}</time>
          {stale ? <span className="calendar__stale"> · last known data</span> : null}
        </p>
      </div>

      <p className="visually-hidden">{summary}</p>

      <CalendarInteractive>
        <div className="calendar__scroll">
          <div className="calendar__grid">
            <div className="calendar__weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map(({ row, text }) => (
                <span key={text} style={{ top: `${(((row + 0.5) * PITCH - 1.5) / height) * 100}%` }}>
                  {text}
                </span>
              ))}
            </div>
            <div className="calendar__months" aria-hidden="true">
              {layout.months.map((month) => (
                <span key={month.date} style={{ left: `${((month.col * PITCH) / width) * 100}%` }}>
                  {formatMonth(month.date)}
                </span>
              ))}
            </div>
            <svg
              className="calendar__svg"
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="grid"
              aria-label={`contribution calendar, ${pluralize(calendar.total, "contribution")}, ${range}. use arrow keys to move between days.`}
            >
              {Array.from({ length: ROWS }, (_, row) => (
                <g role="row" key={row}>
                  {layout.days
                    .filter((day) => day.row === row)
                    .map((day) => (
                      <rect
                        key={day.date}
                        role="gridcell"
                        className={`level-${day.level}`}
                        x={day.col * PITCH}
                        y={row * PITCH}
                        width={CELL}
                        height={CELL}
                        data-row={row}
                        data-col={day.col}
                        aria-label={cellLabel(day.count, day.date)}
                        tabIndex={day.date === latest.date ? 0 : -1}
                      />
                    ))}
                </g>
              ))}
            </svg>
          </div>
        </div>
      </CalendarInteractive>

      <div className="calendar__legend" aria-hidden="true">
        <span>less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i className={`legend-cell level-${level}`} key={level} />
        ))}
        <span>more</span>
        <span className="visually-hidden">{weekCount} weeks shown</span>
      </div>
    </div>
  );
}

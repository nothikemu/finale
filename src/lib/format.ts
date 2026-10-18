/** Formatting helpers. All outputs are lowercase to match the site's voice. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const numberFormat = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Intl formatters are expensive to build, and the calendar formats hundreds of dates. */
function dateFormatter(options: Intl.DateTimeFormatOptions, timeZone?: string): Intl.DateTimeFormat {
  const key = `${timeZone ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Date-only strings (YYYY-MM-DD) are calendar dates and are always read in UTC. */
export function formatCalendarDate(isoDate: string, style: "short" | "long" = "short"): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "short", month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return dateFormatter(options, "UTC").format(date).toLowerCase();
}

export function formatMonth(isoDate: string): string {
  return dateFormatter({ month: "short" }, "UTC").format(new Date(`${isoDate}T00:00:00Z`)).toLowerCase();
}

/** Compact "updated" date for repositories. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter({ month: "short", day: "numeric", year: "numeric" }, "UTC").format(date).toLowerCase();
}

/**
 * Relative time for recent events, absolute date once it is more than a day old.
 * `timeZone` is "UTC" until the client has hydrated, so server and first client
 * render agree; afterwards pass undefined to use the visitor's local zone.
 */
export function formatListenTime(timestampMs: number, nowMs: number, timeZone?: string): string {
  const diff = Math.max(0, nowMs - timestampMs);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return dateFormatter({ month: "short", day: "numeric", year: "numeric" }, timeZone).format(new Date(timestampMs)).toLowerCase();
}

export function formatExactTimestamp(timestampMs: number, timeZone?: string): string {
  return dateFormatter(
    { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" },
    timeZone,
  )
    .format(new Date(timestampMs))
    .toLowerCase();
}

/** m:ss or h:mm:ss */
export function formatClock(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / SECOND));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

import "server-only";

import type { ContributionCalendar, ContributionDay, ContributionLevel } from "@/data/types";
import { fetchUpstreamText, UpstreamError } from "@/lib/server/http";

/**
 * Fallback source for the contribution calendar: the fragment github.com serves
 * to any visitor at /users/{login}/contributions. It is public data, needs no
 * credential, and is not a documented API, so it is parsed defensively and used
 * only when GraphQL is unavailable. Anything unexpected fails closed (the panel
 * then shows "unavailable") rather than rendering guessed numbers.
 *
 * Each day is a cell carrying data-date and data-level; its count lives in a
 * tooltip ("3 contributions on October 6th." / "No contributions on ...") or, in
 * older markup, a data-count attribute.
 */

/** A year of days is at least 365 cells; anything much smaller is a truncated or different page. */
const MIN_CELLS = 360;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag);
  return match?.[1] ?? null;
}

function tooltipCount(text: string): number | null {
  const match = /^\s*(No|\d[\d,]*)\s+contributions?\b/i.exec(text.replace(/\s+/g, " "));
  if (!match) return null;
  return match[1]!.toLowerCase() === "no" ? 0 : Number(match[1]!.replace(/,/g, ""));
}

export function parsePublicCalendar(html: string): ContributionCalendar {
  const invalid = () => new UpstreamError("invalid-response", "github-public");

  // tooltip text keyed by the id of the cell it describes
  const tooltips = new Map<string, number>();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const target = attribute(` ${match[1]}`, "for");
    const count = tooltipCount(match[2] ?? "");
    if (target && count !== null) tooltips.set(target, count);
  }

  const days = new Map<string, ContributionDay>();
  for (const match of html.matchAll(/<(?:td|rect)\b[^>]*>/gi)) {
    const tag = match[0];
    const date = attribute(tag, "data-date");
    if (!date || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) continue;

    // The level must be present and 0-4: a missing or blank value must not silently become 0.
    const rawLevel = attribute(tag, "data-level");
    if (rawLevel === null || !/^[0-4]$/.test(rawLevel)) throw invalid();
    const level = Number(rawLevel);

    const id = attribute(tag, "id");
    const direct = attribute(tag, "data-count");
    const count = direct !== null && /^\d+$/.test(direct) ? Number(direct) : id ? (tooltips.get(id) ?? null) : null;
    // A level without a count would force us to invent one.
    if (count === null && level > 0) throw invalid();
    days.set(date, { date, count: count ?? 0, level: level as ContributionLevel });
  }
  if (days.size < MIN_CELLS) throw invalid();

  const sorted = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Every day in the range must be present: a dropped day would be an undetected undercount.
  for (let i = 1; i < sorted.length; i += 1) {
    if (Date.parse(`${sorted[i]!.date}T00:00:00Z`) - Date.parse(`${sorted[i - 1]!.date}T00:00:00Z`) !== DAY_MS) throw invalid();
  }
  const first = sorted[0]!;
  const start = Date.parse(`${first.date}T00:00:00Z`);
  const weekZero = start - new Date(start).getUTCDay() * DAY_MS;
  const weeks: ContributionDay[][] = [];
  for (const day of sorted) {
    const index = Math.floor((Date.parse(`${day.date}T00:00:00Z`) - weekZero) / (7 * DAY_MS));
    (weeks[index] ??= []).push(day);
  }

  return {
    total: sorted.reduce((sum, day) => sum + day.count, 0),
    weeks: weeks.filter(Boolean),
    from: first.date,
    to: sorted[sorted.length - 1]!.date,
  };
}

export async function fetchPublicCalendar(username: string): Promise<ContributionCalendar> {
  const html = await fetchUpstreamText(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    service: "github-public",
    init: { headers: { accept: "text/html" } },
    timeoutMs: 5000,
    retries: 1,
  });
  const calendar = parsePublicCalendar(html);
  // The page also states its own total. A mismatch is not fatal (we show the days we parsed) but is worth knowing.
  const stated = /([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i.exec(html)?.[1];
  if (stated && Number(stated.replace(/,/g, "")) !== calendar.total) {
    console.warn(`[github-public] the page states ${stated} contributions but its days add up to ${calendar.total}`);
  }
  return calendar;
}

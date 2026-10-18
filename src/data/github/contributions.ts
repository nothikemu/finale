import "server-only";

import { z } from "zod";
import { cacheTtl, site } from "@/config/site";
import type { ContributionCalendar, ContributionDay, ContributionLevel, Loaded } from "@/data/types";
import { toLoaded } from "@/lib/server/cache";
import { MissingConfigError, serverEnv, warnOnce } from "@/lib/server/env";
import { fetchUpstreamJson, isUpstreamError, UpstreamError } from "@/lib/server/http";
import { fetchPublicCalendar } from "./public-calendar";

const QUERY = `query ContributionCalendar($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

const LEVELS: Record<string, ContributionLevel> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const dayShape = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contributionCount: z.number().int().nonnegative(),
  contributionLevel: z.string(),
});

const responseSchema = z.object({
  data: z
    .object({
      user: z
        .object({
          contributionsCollection: z.object({
            contributionCalendar: z.object({
              totalContributions: z.number().int().nonnegative(),
              weeks: z.array(z.object({ contributionDays: z.array(dayShape) })),
            }),
          }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional() }).passthrough()).optional(),
});

export function normalizeCalendar(payload: unknown): ContributionCalendar {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new UpstreamError("invalid-response", "github-graphql");

  const calendar = parsed.data.data?.user?.contributionsCollection.contributionCalendar;
  if (!calendar) {
    const errorType = parsed.data.errors?.[0]?.type;
    if (errorType === "NOT_FOUND") throw new UpstreamError("not-found", "github-graphql");
    if (errorType === "FORBIDDEN" || errorType === "INSUFFICIENT_SCOPES") throw new UpstreamError("auth", "github-graphql");
    throw new UpstreamError("invalid-response", "github-graphql");
  }

  const weeks: ContributionDay[][] = calendar.weeks
    .map((week) =>
      week.contributionDays.map((day) => ({
        date: day.date,
        count: day.contributionCount,
        // Prefer GitHub's own level; derive only if GitHub adds an unknown value.
        level: LEVELS[day.contributionLevel] ?? ((day.contributionCount > 0 ? 1 : 0) as ContributionLevel),
      })),
    )
    .filter((week) => week.length > 0);

  const first = weeks[0]?.[0];
  const lastWeek = weeks[weeks.length - 1];
  const last = lastWeek?.[lastWeek.length - 1];
  if (!first || !last) throw new UpstreamError("invalid-response", "github-graphql");

  return { total: calendar.totalContributions, weeks, from: first.date, to: last.date };
}

async function fetchGraphql(username: string, token: string): Promise<ContributionCalendar> {
  const { json } = await fetchUpstreamJson("https://api.github.com/graphql", {
    service: "github-graphql",
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { login: username } }),
    },
  });
  return normalizeCalendar(json);
}

/**
 * GraphQL when a token is configured; otherwise (or when GitHub rejects the
 * token) the public contributions graph, so the calendar still shows the same
 * public data. Without a token, and without the fallback, it is "not configured".
 */
async function fetchCalendar(username: string): Promise<ContributionCalendar> {
  const token = serverEnv.githubToken;
  let primaryError: UpstreamError | undefined;

  if (token) {
    try {
      return await fetchGraphql(username, token);
    } catch (error) {
      if (!isUpstreamError(error)) throw error;
      // A rate limit applies to the public page too; everything else may succeed there.
      if (error.kind === "rate-limited" || !site.github.publicCalendarFallback) throw error;
      primaryError = error;
      console.warn(`[github] GraphQL calendar failed (${error.message}); trying the public contributions graph`);
    }
  } else {
    warnOnce("github-token", "GITHUB_TOKEN is not set; the calendar uses the public contributions graph if it can.");
  }

  if (site.github.publicCalendarFallback) {
    try {
      return await fetchPublicCalendar(username);
    } catch (error) {
      if (!isUpstreamError(error)) throw error;
      console.warn(`[github] public contributions graph failed (${error.message})`);
      if (!token) {
        // A token only helps if the page itself is unusable. For network, rate-limit and
        // server errors the honest answer is the real cause, not "not configured".
        if (error.kind === "not-found" || error.kind === "invalid-response" || error.kind === "auth") throw new MissingConfigError(["GITHUB_TOKEN"]);
        throw error;
      }
      throw primaryError ?? error;
    }
  }
  throw new MissingConfigError(["GITHUB_TOKEN"]);
}

export function loadContributions(username: string = site.githubUsername): Promise<Loaded<ContributionCalendar>> {
  return toLoaded({
    key: `github:calendar:${username}`,
    ttlMs: cacheTtl.contributions,
    load: () => fetchCalendar(username),
  });
}

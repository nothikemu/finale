import "server-only";

import { z } from "zod";
import { cacheTtl, site } from "@/config/site";
import type { ContributionCalendar, ContributionDay, ContributionLevel, Loaded } from "@/data/types";
import { toLoaded } from "@/lib/server/cache";
import { MissingConfigError, serverEnv, warnOnce } from "@/lib/server/env";
import { fetchUpstreamJson, UpstreamError } from "@/lib/server/http";

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

async function fetchCalendar(username: string): Promise<ContributionCalendar> {
  const token = serverEnv.githubToken;
  if (!token) {
    warnOnce("github-token", "GITHUB_TOKEN is not set; the contribution calendar is unavailable.");
    throw new MissingConfigError(["GITHUB_TOKEN"]);
  }
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

export function loadContributions(username: string = site.githubUsername): Promise<Loaded<ContributionCalendar>> {
  return toLoaded({
    key: `github:calendar:${username}`,
    ttlMs: cacheTtl.contributions,
    load: () => fetchCalendar(username),
  });
}

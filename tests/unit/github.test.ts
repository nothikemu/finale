import { describe, expect, it } from "vitest";
import { normalizeCalendar } from "@/data/github/contributions";
import { normalizeRepositories } from "@/data/github/projects";

const repo = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "rocket-sim",
  description: "sim",
  language: "TypeScript",
  stargazers_count: 3,
  forks_count: 1,
  archived: false,
  fork: false,
  updated_at: "2026-01-02T03:04:05Z",
  ...overrides,
});

describe("normalizeRepositories", () => {
  it("normalises public repositories and builds the URL from validated parts", () => {
    const { repositories } = normalizeRepositories([repo({ html_url: "https://evil.test" })], "nothikemu");
    expect(repositories[0]).toMatchObject({ name: "rocket-sim", url: "https://github.com/nothikemu/rocket-sim", stars: 3, forks: 1, archived: false, fork: false });
  });
  it("keeps forks and archived repositories", () => {
    const { repositories } = normalizeRepositories([repo({ fork: true }), repo({ id: 2, name: "old", archived: true })], "nothikemu");
    expect(repositories.map((r) => [r.name, r.fork, r.archived])).toEqual([
      ["rocket-sim", true, false],
      ["old", false, true],
    ]);
  });
  it("drops private or malformed records instead of failing the whole list", () => {
    const result = normalizeRepositories([repo({ private: true }), repo({ name: "../etc" }), { id: "x" }, repo({ id: 9, name: "ok" })], "nothikemu");
    expect(result.repositories.map((r) => r.name)).toEqual(["ok"]);
    expect(result.skipped).toBe(3);
  });
});

describe("normalizeCalendar", () => {
  const day = (date: string, count: number, level: string) => ({ date, contributionCount: count, contributionLevel: level });
  const payload = {
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: 5,
            weeks: [
              { contributionDays: [day("2026-01-04", 0, "NONE"), day("2026-01-05", 2, "SECOND_QUARTILE")] },
              { contributionDays: [day("2026-01-11", 3, "FOURTH_QUARTILE")] },
            ],
          },
        },
      },
    },
  };

  it("maps GitHub's contribution levels and reports the real range and total", () => {
    const calendar = normalizeCalendar(payload);
    expect(calendar.total).toBe(5);
    expect(calendar.from).toBe("2026-01-04");
    expect(calendar.to).toBe("2026-01-11");
    expect(calendar.weeks.flat().map((d) => d.level)).toEqual([0, 2, 4]);
  });
  it("maps GraphQL errors to typed failures", () => {
    expect(() => normalizeCalendar({ data: { user: null }, errors: [{ type: "NOT_FOUND" }] })).toThrow(/not-found/);
    expect(() => normalizeCalendar({ data: null, errors: [{ type: "FORBIDDEN" }] })).toThrow(/auth/);
    expect(() => normalizeCalendar({ nope: 1 })).toThrow(/invalid-response/);
  });
});

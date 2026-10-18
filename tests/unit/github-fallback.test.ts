import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { site } from "@/config/site";
import { loadContributions } from "@/data/github/contributions";
import { loadProjects } from "@/data/github/projects";
import { clearCache } from "@/lib/server/cache";

const DAY = 86_400_000;

function publicHtml(statedTotal?: string): string {
  const last = Date.parse("2026-10-18T00:00:00Z");
  const days = Array.from({ length: 365 }, (_, i) => new Date(last - (364 - i) * DAY).toISOString().slice(0, 10));
  const tds = days.map((date, i) => `<td data-date="${date}" id="c-${i}" data-level="${i % 3 === 0 ? 1 : 0}"></td>`).join("");
  const tips = days.map((_, i) => `<tool-tip for="c-${i}">${i % 3 === 0 ? "2 contributions on October 1st." : "No contributions on October 1st."}</tool-tip>`).join("");
  return `<h2>${statedTotal ?? "x"} contributions in the last year</h2><table>${tds}</table>${tips}`;
}

const GRAPHQL_OK = {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: { totalContributions: 7, weeks: [{ contributionDays: [{ date: "2026-10-18", contributionCount: 7, contributionLevel: "FOURTH_QUARTILE" }] }] },
      },
    },
  },
};

const repo = (n: number) => ({ id: n, name: `repo-${n}`, stargazers_count: 0, forks_count: 0, archived: false, fork: false, updated_at: "2026-01-01T00:00:00Z" });

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
const calls: { url: string; auth: string | null }[] = [];

function mockFetch(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.href, auth: new Headers(init.headers).get("authorization") });
      return handler(url, init);
    }),
  );
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

beforeEach(() => {
  clearCache();
  calls.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  delete process.env.GITHUB_TOKEN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  site.github.publicCalendarFallback = true;
  delete process.env.GITHUB_TOKEN;
});

describe("contribution calendar sources", () => {
  it("uses GraphQL when the token works, and never touches the public page", async () => {
    process.env.GITHUB_TOKEN = "t";
    mockFetch((url) => (url.hostname === "api.github.com" ? json(GRAPHQL_OK) : html("", 500)));
    const result = await loadContributions();
    expect(result).toMatchObject({ status: "ok", data: { total: 7 } });
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["api.github.com"]);
  });

  it("falls back to the public graph when GitHub rejects the token", async () => {
    process.env.GITHUB_TOKEN = "t";
    mockFetch((url) => (url.hostname === "api.github.com" ? json({ message: "Bad credentials" }, 401) : html(publicHtml())));
    const result = await loadContributions();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data.weeks.flat()).toHaveLength(365);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["api.github.com", "github.com"]);
  });

  it("falls back when GraphQL answers with a permission error instead of data", async () => {
    process.env.GITHUB_TOKEN = "t";
    mockFetch((url) => (url.hostname === "api.github.com" ? json({ data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] }) : html(publicHtml())));
    expect((await loadContributions()).status).toBe("ok");
  });

  it("works with no token at all via the public graph", async () => {
    mockFetch((url) => (url.hostname === "github.com" ? html(publicHtml()) : json({}, 500)));
    const result = await loadContributions();
    expect(result.status).toBe("ok");
    expect(calls.every((c) => c.auth === null)).toBe(true);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["github.com"]);
  });

  it("says 'missing configuration' only when there is no token and the public graph is unusable", async () => {
    mockFetch(() => html("Not Found", 404));
    expect(await loadContributions()).toEqual({ status: "missing-config", missing: ["GITHUB_TOKEN"] });
  });

  it("reports the token problem (not the fallback's) when both sources fail", async () => {
    process.env.GITHUB_TOKEN = "t";
    mockFetch((url) => (url.hostname === "api.github.com" ? json({ message: "Bad credentials" }, 401) : html("Not Found", 404)));
    const result = await loadContributions();
    expect(result).toMatchObject({ status: "unavailable", reason: "auth", detail: "github-graphql: auth (401)" });
  });

  it("does not hammer the public page when GitHub is rate limiting us", async () => {
    process.env.GITHUB_TOKEN = "t";
    mockFetch(() => json({ message: "rate limited" }, 429, { "retry-after": "600" }));
    const result = await loadContributions();
    expect(result).toMatchObject({ status: "unavailable", reason: "rate-limited" });
    expect(calls).toHaveLength(1);
  });

  it("without a token, reports the real cause when the public graph fails for a reason a token would not fix", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await loadContributions()).toMatchObject({ status: "unavailable", reason: "network", detail: "github-public: network" });

    clearCache();
    mockFetch(() => json({ message: "rate limited" }, 429, { "retry-after": "600" }));
    expect(await loadContributions()).toMatchObject({ status: "unavailable", reason: "rate-limited" });
  });

  it("without a token, says 'missing configuration' when the public page itself is unusable", async () => {
    mockFetch(() => html("<html>sign in</html>")); // 200, but not a contribution graph
    expect(await loadContributions()).toEqual({ status: "missing-config", missing: ["GITHUB_TOKEN"] });
  });

  it("logs why the public graph failed, so the owner has a signal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch(() => html("Not Found", 404));
    await loadContributions();
    expect(warn.mock.calls.flat().join("\n")).toMatch(/public contributions graph failed \(github-public: not-found/);
  });

  it("warns, but still shows the parsed days, when the page's own total disagrees", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch(() => html(publicHtml("99,999")));
    expect((await loadContributions()).status).toBe("ok");
    expect(warn.mock.calls.flat().join("\n")).toMatch(/states 99,999 contributions/);
  });

  it("can be restricted to GraphQL only", async () => {
    site.github.publicCalendarFallback = false;
    process.env.GITHUB_TOKEN = "t";
    mockFetch(() => json({ message: "Bad credentials" }, 401));
    expect(await loadContributions()).toMatchObject({ status: "unavailable", reason: "auth" });
    expect(calls).toHaveLength(1);

    clearCache();
    delete process.env.GITHUB_TOKEN;
    expect(await loadContributions()).toEqual({ status: "missing-config", missing: ["GITHUB_TOKEN"] });
  });

  it("never puts the token in a failure detail", async () => {
    process.env.GITHUB_TOKEN = "super-secret-token-value";
    mockFetch(() => json({ message: "Bad credentials" }, 401));
    expect(JSON.stringify(await loadContributions())).not.toContain("super-secret-token-value");
  });
});

describe("repositories", () => {
  it("lists public repositories anonymously when GitHub rejects the token", async () => {
    process.env.GITHUB_TOKEN = "bad";
    mockFetch((_url, init) => (new Headers(init.headers).get("authorization") ? json({ message: "Bad credentials" }, 401) : json([repo(1), repo(2)])));
    const result = await loadProjects();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data.map((r) => r.name)).toEqual(["repo-1", "repo-2"]);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer bad", null]);
  });

  it("uses the token when it works, and works without one", async () => {
    process.env.GITHUB_TOKEN = "good";
    mockFetch(() => json([repo(1)]));
    expect((await loadProjects()).status).toBe("ok");
    expect(calls.map((c) => c.auth)).toEqual(["Bearer good"]);

    clearCache();
    calls.length = 0;
    delete process.env.GITHUB_TOKEN;
    expect((await loadProjects()).status).toBe("ok");
    expect(calls.map((c) => c.auth)).toEqual([null]);
  });

  it("is unavailable, with a typed reason, if even anonymous access fails", async () => {
    process.env.GITHUB_TOKEN = "bad";
    mockFetch((_url, init) => (new Headers(init.headers).get("authorization") ? json({}, 401) : json({}, 403, { "x-ratelimit-remaining": "0", "retry-after": "3600" })));
    expect(await loadProjects()).toMatchObject({ status: "unavailable", reason: "rate-limited" });
  });
});

describe("an answer that is not a repository list", () => {
  it("is a failure, not 'no public repositories'", async () => {
    mockFetch(() => json({ message: "something else entirely" }));
    expect(await loadProjects()).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("is a failure when every record is unreadable, but not when only some are", async () => {
    mockFetch(() => json([{ nonsense: true }, { also: "nonsense" }]));
    expect(await loadProjects()).toMatchObject({ status: "unavailable", reason: "invalid-response" });
    clearCache();
    mockFetch(() => json([repo(1), { nonsense: true }]));
    expect(await loadProjects()).toMatchObject({ status: "ok", data: [{ name: "repo-1" }] });
  });

  it("still treats a genuinely empty account as empty", async () => {
    mockFetch(() => json([]));
    expect(await loadProjects()).toMatchObject({ status: "ok", data: [] });
  });
});

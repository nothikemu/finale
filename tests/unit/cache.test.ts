import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearCache, toLoaded } from "@/lib/server/cache";
import { MissingConfigError } from "@/lib/server/env";
import { parseRetryAfter, UpstreamError } from "@/lib/server/http";

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cached", () => {
  it("serves fresh values without calling upstream again", async () => {
    const load = vi.fn().mockResolvedValue("a");
    await cached({ key: "k", ttlMs: 1000, load });
    vi.advanceTimersByTime(500);
    const second = await cached({ key: "k", ttlMs: 1000, load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ data: "a", stale: false });
  });

  it("de-duplicates simultaneous loads", async () => {
    let release!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const first = cached({ key: "k", ttlMs: 1000, load });
    const second = cached({ key: "k", ttlMs: 1000, load });
    release("v");
    expect((await first).data).toBe("v");
    expect((await second).data).toBe("v");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps last-known-good data, flagged stale, when a refresh fails", async () => {
    const load = vi.fn().mockResolvedValueOnce("good").mockRejectedValue(new UpstreamError("network", "svc"));
    await cached({ key: "k", ttlMs: 1000, load });
    vi.advanceTimersByTime(2000);
    const result = await cached({ key: "k", ttlMs: 1000, load });
    expect(result).toMatchObject({ data: "good", stale: true });
  });

  it("does not hammer a failing upstream: errors are negative-cached briefly", async () => {
    const load = vi.fn().mockRejectedValue(new UpstreamError("upstream", "svc", 500));
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toBeInstanceOf(UpstreamError);
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toBeInstanceOf(UpstreamError);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11_000);
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toBeInstanceOf(UpstreamError);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After as a cool-down", async () => {
    const load = vi.fn().mockRejectedValue(new UpstreamError("rate-limited", "svc", 429, 60_000));
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toThrow();
    vi.advanceTimersByTime(30_000);
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await expect(cached({ key: "k", ttlMs: 1000, load })).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("toLoaded", () => {
  it("folds failures into renderable states without leaking details", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing = await toLoaded({ key: "a", ttlMs: 1, load: async () => { throw new MissingConfigError(["GITHUB_TOKEN"]); } });
    expect(missing).toEqual({ status: "missing-config", missing: ["GITHUB_TOKEN"] });

    const down = await toLoaded({ key: "b", ttlMs: 1, load: async () => { throw new UpstreamError("auth", "svc", 401); } });
    expect(down).toEqual({ status: "unavailable", reason: "auth", detail: "svc: auth (401)" });

    const unknown = await toLoaded({ key: "c", ttlMs: 1, load: async () => { throw new Error("token=SECRET123"); } });
    expect(JSON.stringify(unknown)).not.toContain("SECRET123");
    // an arbitrary error is reduced to its cache key: its own message is never forwarded
    expect(unknown).toEqual({ status: "unavailable", reason: "upstream", detail: "c: upstream" });
  });

  it("reports ok with the stale flag", async () => {
    const result = await toLoaded({ key: "d", ttlMs: 1000, load: async () => 7 });
    expect(result).toMatchObject({ status: "ok", data: 7, stale: false });
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("reads seconds, HTTP dates and rate-limit reset headers", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "12" }), now)).toBe(12_000);
    expect(parseRetryAfter(new Headers({ "retry-after": "Thu, 01 Jan 2026 00:00:30 GMT" }), now)).toBe(30_000);
    expect(parseRetryAfter(new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 45) }), now)).toBe(45_000);
    expect(parseRetryAfter(new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset-in": "9" }), now)).toBe(9_000);
    expect(parseRetryAfter(new Headers(), now)).toBeUndefined();
  });
});

describe("errors that come from another copy of the class", () => {
  // Next.js bundles each route separately, so the page and /api/* or /status each get their own
  // UpstreamError / MissingConfigError class while sharing one cache. These stand in for the other copy.
  class ForeignUpstreamError extends Error {
    readonly kind: string;
    readonly service: string;
    readonly status?: number;
    constructor(kind: string, service: string, status?: number) {
      super(`${service}: ${kind}${status ? ` (${status})` : ""}`);
      this.name = "UpstreamError";
      this.kind = kind;
      this.service = service;
      this.status = status;
    }
    get reason() {
      return this.kind === "rate-limited" ? "rate-limited" : this.kind === "network" ? "network" : "upstream";
    }
  }
  class ForeignMissingConfigError extends Error {
    constructor(readonly missing: string[]) {
      super("missing");
      this.name = "MissingConfigError";
    }
  }

  it("keeps the real cause instead of demoting it to a vague upstream error", async () => {
    const result = await toLoaded({ key: "k-foreign", ttlMs: 1000, load: () => Promise.reject(new ForeignUpstreamError("network", "listenbrainz")) });
    expect(result).toMatchObject({ status: "unavailable", reason: "network", detail: "listenbrainz: network" });
  });

  it("keeps the cause when it is served from the cool-down of an earlier failure", async () => {
    const first = await toLoaded({ key: "k-cool", ttlMs: 1000, load: () => Promise.reject(new ForeignUpstreamError("rate-limited", "github-repos", 403)) });
    const second = await toLoaded({ key: "k-cool", ttlMs: 1000, load: () => Promise.resolve("never called while cooling down") });
    expect(first).toMatchObject({ reason: "rate-limited" });
    expect(second).toMatchObject({ status: "unavailable", reason: "rate-limited", detail: "github-repos: rate-limited (403)" });
  });

  it("still reports a missing configuration from the other copy as one", async () => {
    const result = await toLoaded({ key: "k-missing", ttlMs: 1000, load: () => Promise.reject(new ForeignMissingConfigError(["DISCORD_USER_ID"])) });
    expect(result).toEqual({ status: "missing-config", missing: ["DISCORD_USER_ID"] });
  });

  it("does not mistake an ordinary error for an upstream error", async () => {
    const result = await toLoaded({ key: "k-plain", ttlMs: 1000, load: () => Promise.reject(new Error("boom")) });
    expect(result).toMatchObject({ status: "unavailable", reason: "upstream", detail: "k-plain: upstream" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identity } from "@/config/identity";
import { loadListening, normalizeListens, normalizePlayingNow, parseUsernames, splitUsernames } from "@/data/listenbrainz";
import { clearCache } from "@/lib/server/cache";

const MBID = "0a1b2c3d-1111-2222-3333-444455556666";

function listen(overrides: Record<string, unknown> = {}, info: Record<string, unknown> | null = null) {
  return {
    listened_at: 1_700_000_100,
    recording_msid: "msid-1",
    track_metadata: {
      artist_name: "Artist",
      track_name: "Track",
      release_name: "Album",
      additional_info: info,
      ...overrides,
    },
  };
}

const spotifyInfo = { music_service: "spotify.com", spotify_id: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" };

describe("normalizeListens", () => {
  it("returns newest first with milliseconds and only verified links", () => {
    const { listens } = normalizeListens({
      payload: {
        listens: [
          listen({ track_name: "Older" }, null),
          { ...listen({}, { ...spotifyInfo }), listened_at: 1_700_000_500, recording_msid: "msid-2" },
        ],
      },
    });
    // "Older" has no source metadata, so Spotify-origin filtering drops it.
    expect(listens.map((l) => l.title)).toEqual(["Track"]);
    expect(listens[0]).toMatchObject({
      listenedAt: 1_700_000_500_000,
      spotifyUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      artworkUrl: null,
    });
  });

  it("keeps repeated plays but collapses exact duplicate copies", () => {
    const base = listen({}, null);
    const { listens } = normalizeListens({
      payload: { listens: [base, { ...base }, { ...base, listened_at: base.listened_at + 300 }] },
    });
    expect(listens).toHaveLength(2);
  });

  it("filters to Spotify-origin entries only when metadata reliably identifies some", () => {
    const mixed = normalizeListens({
      payload: { listens: [listen({ track_name: "A" }, spotifyInfo), { ...listen({ track_name: "B" }, null), listened_at: 1_700_000_050 }] },
    });
    expect(mixed.spotifyOnly).toBe(true);
    expect(mixed.listens.map((l) => l.title)).toEqual(["A"]);

    const unknown = normalizeListens({ payload: { listens: [listen({ track_name: "A" }, null), { ...listen({ track_name: "B" }, null), listened_at: 1_700_000_050 }] } });
    expect(unknown.spotifyOnly).toBe(false);
    expect(unknown.listens).toHaveLength(2);
  });

  it("builds cover art URLs only from valid Cover Art Archive ids", () => {
    const ok = normalizeListens({ payload: { listens: [listen({ mbid_mapping: { caa_id: 123, caa_release_mbid: MBID } })] } });
    expect(ok.listens[0]?.artworkUrl).toBe(`https://coverartarchive.org/release/${MBID}/123-250.jpg`);
    const bad = normalizeListens({ payload: { listens: [listen({ mbid_mapping: { caa_id: 123, caa_release_mbid: "../../x" } })] } });
    expect(bad.listens[0]?.artworkUrl).toBeNull();
  });

  it("skips malformed entries and rejects malformed envelopes", () => {
    expect(normalizeListens({ payload: { listens: [{ nope: true }, listen()] } }).listens).toHaveLength(1);
    expect(() => normalizeListens({ payload: {} })).toThrow();
    expect(normalizeListens({ payload: { listens: [] } }).listens).toEqual([]);
  });

  it("never accepts non-Spotify links as Spotify links", () => {
    const { listens } = normalizeListens({
      payload: { listens: [listen({}, { spotify_id: "https://evil.test/track/4uLU6hMCjMI75M1A2tKUQC", origin_url: "javascript:alert(1)" })] },
    });
    expect(listens[0]?.spotifyUrl).toBeNull();
  });
});

describe("normalizePlayingNow", () => {
  it("returns the current track without inventing progress", () => {
    const track = normalizePlayingNow({ payload: { listens: [{ playing_now: true, track_metadata: { artist_name: "A", track_name: "T" } }] } });
    expect(track).toMatchObject({ title: "T", artist: "A", album: null });
    expect(track).not.toHaveProperty("progress");
  });
  it("is null when nothing is playing", () => {
    expect(normalizePlayingNow({ payload: { listens: [] } })).toBeNull();
    expect(normalizePlayingNow("garbage")).toBeNull();
  });
});

describe("normalizeListens null handling", () => {
  it("keeps listens whose optional fields are explicit nulls or malformed", () => {
    const { listens } = normalizeListens({
      payload: {
        listens: [
          {
            listened_at: 1_700_000_100,
            track_metadata: {
              artist_name: "A",
              track_name: "T",
              release_name: null,
              additional_info: { music_service: "spotify.com", spotify_id: null, origin_url: 7 },
              mbid_mapping: null,
            },
          },
        ],
      },
    });
    expect(listens).toHaveLength(1);
    expect(listens[0]).toMatchObject({ title: "T", album: null, spotifyUrl: null });
  });
});

describe("listen ids", () => {
  const at = (ts: number, name: string) => ({ ...listen({ track_name: name }, null), listened_at: ts, recording_msid: name });

  it("keep their identity when a newer listen arrives, so rows are not remounted", () => {
    const before = normalizeListens({ payload: { listens: [at(1_700_000_200, "B"), at(1_700_000_100, "A")] } }).listens;
    const after = normalizeListens({ payload: { listens: [at(1_700_000_300, "C"), at(1_700_000_200, "B"), at(1_700_000_100, "A")] } }).listens;
    for (const old of before) expect(after.find((l) => l.title === old.title)?.id).toBe(old.id);
    expect(new Set(after.map((l) => l.id)).size).toBe(3);
  });

  it("differ for different listens, even in the same second", () => {
    const { listens } = normalizeListens({ payload: { listens: [at(1_700_000_100, "A"), at(1_700_000_100, "B")] } });
    expect(new Set(listens.map((l) => l.id)).size).toBe(2);
  });
});

describe("Spotify narrowing", () => {
  it("reports how many listens it left out so the panel can say so", () => {
    const mixed = normalizeListens({
      payload: {
        listens: [
          { ...listen({ track_name: "From Spotify" }, spotifyInfo), listened_at: 1_700_000_300, recording_msid: "a" },
          { ...listen({ track_name: "Elsewhere 1" }, null), listened_at: 1_700_000_200, recording_msid: "b" },
          { ...listen({ track_name: "Elsewhere 2" }, null), listened_at: 1_700_000_100, recording_msid: "c" },
        ],
      },
    });
    expect(mixed).toMatchObject({ spotifyOnly: true, omitted: 2 });
    expect(mixed.listens.map((l) => l.title)).toEqual(["From Spotify"]);
  });

  it("hides nothing when ListenBrainz marks none, or all, as Spotify", () => {
    const none = normalizeListens({ payload: { listens: [listen({ track_name: "A" }, null)] } });
    expect(none).toMatchObject({ spotifyOnly: false, omitted: 0 });
    const all = normalizeListens({ payload: { listens: [listen({ track_name: "A" }, spotifyInfo)] } });
    expect(all).toMatchObject({ spotifyOnly: false, omitted: 0 });
  });

  it("recognises a Spotify track link in origin_url as Spotify", () => {
    const viaUrl = normalizeListens({
      payload: {
        listens: [
          { ...listen({ track_name: "Link only" }, { origin_url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }), recording_msid: "x", listened_at: 1_700_000_300 },
          { ...listen({ track_name: "Other" }, null), recording_msid: "y", listened_at: 1_700_000_200 },
        ],
      },
    });
    expect(viaUrl.listens.map((l) => l.title)).toEqual(["Link only"]);
  });
});

describe("parseUsernames", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits, trims, de-duplicates and caps candidates, and drops unusable ones", () => {
    expect(parseUsernames("nothikemu, hikemu")).toEqual(["nothikemu", "hikemu"]);
    expect(parseUsernames(" a ,a, ,b,, ")).toEqual(["a", "b"]);
    expect(parseUsernames("1,2,3,4,5,6,7")).toHaveLength(5);
    expect(parseUsernames("good,a/b,c?d,ひかる")).toEqual(["good", "ひかる"]);
    expect(parseUsernames(undefined)).toEqual([]);
    expect(parseUsernames("")).toEqual([]);
  });

  it("accepts the ways people actually write 'this one or that one'", () => {
    expect(parseUsernames("nothikemu or hikemu")).toEqual(["nothikemu", "hikemu"]);
    expect(parseUsernames("nothikemu OR hikemu")).toEqual(["nothikemu", "hikemu"]);
    expect(parseUsernames("nothikemu; hikemu | third")).toEqual(["nothikemu", "hikemu", "third"]);
    expect(parseUsernames("@nothikemu, @@hikemu")).toEqual(["nothikemu", "hikemu"]);
    expect(parseUsernames("listenbrainz.org/user/nothikemu, www.listenbrainz.org/user/hikemu/")).toEqual(["nothikemu", "hikemu"]);
    // a word that merely contains "or" is part of a name
    expect(parseUsernames("viktor, orion")).toEqual(["viktor", "orion"]);
  });

  it("counts entries it could not use, so the panel can say so", () => {
    expect(splitUsernames("good, a/b, c?d")).toEqual({ valid: ["good"], rejected: 2 });
    expect(splitUsernames("")).toEqual({ valid: [], rejected: 0 });
  });

  it("accepts a pasted profile address, which is a common way to copy a username", () => {
    expect(parseUsernames("https://listenbrainz.org/user/nothikemu/")).toEqual(["nothikemu"]);
    expect(parseUsernames("http://www.listenbrainz.org/user/hikemu?foo=1, other")).toEqual(["hikemu", "other"]);
    expect(parseUsernames("https://listenbrainz.org/user/%E3%81%B2%E3%81%8B%E3%82%8B/")).toEqual(["ひかる"]);
    // anything else that looks like a URL is not a username
    expect(parseUsernames("https://example.com/user/nothikemu")).toEqual([]);
  });
});

describe("loadListening: which account is read", () => {
  const TOKEN = "11111111-2222-3333-4444-555555555555"; // made up for this test
  const requests: { url: string; authorization: string | null }[] = [];

  /** `known` are the accounts ListenBrainz has; any other name is a 404 like the real API. */
  function stubListenBrainz(options: { tokenOwner?: string | null; known?: string[]; failing?: string[]; empty?: string[] } = {}) {
    const { tokenOwner = "hkmu", known = ["hkmu", "tokenowner", "nothikemu", "ひかる_01"], failing = [], empty = [] } = options;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = new URL(String(input));
        requests.push({ url: url.href, authorization: new Headers(init.headers).get("authorization") });
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        if (url.pathname === "/1/validate-token") {
          return tokenOwner === null
            ? json({ code: 200, message: "Token invalid.", valid: false })
            : json({ code: 200, message: "Token valid.", valid: true, user_name: tokenOwner });
        }
        const account = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (failing.includes(account)) return json({ code: 500, error: "boom" }, 500);
        if (!known.includes(account)) return json({ code: 404, error: `Cannot find user: ${account}` }, 404);
        if (url.pathname.endsWith("/playing-now") || empty.includes(account)) return json({ payload: { count: 0, playing_now: url.pathname.endsWith("/playing-now"), listens: [] } });
        return json({ payload: { count: 1, listens: [listen({ track_name: `Song of ${account}` }, spotifyInfo)] } });
      }),
    );
  }
  const paths = () => requests.map((r) => new URL(r.url).pathname);

  beforeEach(() => {
    clearCache();
    requests.length = 0;
    delete process.env.LISTENBRAINZ_USERNAME;
    delete process.env.LISTENBRAINZ_TOKEN;
    identity.listenbrainzUsername = null;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LISTENBRAINZ_USERNAME;
    delete process.env.LISTENBRAINZ_TOKEN;
    identity.listenbrainzUsername = null;
  });

  it("reads a configured username directly, with no token and no authorization header", async () => {
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    stubListenBrainz();
    const result = await loadListening();
    expect(result).toMatchObject({ status: "ok", data: { account: "hkmu", listens: [{ title: "Song of hkmu" }] } });
    expect(paths()).toEqual(expect.arrayContaining(["/1/user/hkmu/listens", "/1/user/hkmu/playing-now"]));
    expect(requests.some((r) => r.url.includes("validate-token"))).toBe(false);
    expect(requests.every((r) => r.authorization === null)).toBe(true);
  });

  it("takes the username from src/config/identity.ts when the environment has none, and the environment wins when it does", async () => {
    stubListenBrainz();
    identity.listenbrainzUsername = "nothikemu";
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "nothikemu" } });
    clearCache();
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu" } });
  });

  it("lets a valid token decide whose listens these are, and sends the token only to validate-token", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu"; // a guess; the token knows better
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz({ tokenOwner: "tokenowner" });
    const result = await loadListening();
    expect(result).toMatchObject({ status: "ok", data: { account: "tokenowner" } });
    const validate = requests.filter((r) => r.url.includes("validate-token"));
    expect(validate).toHaveLength(1);
    expect(validate[0]!.authorization).toBe(`Token ${TOKEN}`);
    expect(requests.filter((r) => !r.url.includes("validate-token")).every((r) => r.authorization === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("works with only a token, asking ListenBrainz whose it is once", async () => {
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz({ tokenOwner: "tokenowner" });
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "tokenowner" } });
    await loadListening();
    expect(requests.filter((r) => r.url.includes("validate-token"))).toHaveLength(1);
  });

  it("falls back to the configured username when the token is rejected, e.g. after it was reset", async () => {
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz({ tokenOwner: null });
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu" } });
  });

  it("falls back to the configured username when the token cannot be checked at all", async () => {
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    const real = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/1/validate-token") throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ payload: { count: 0, listens: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", real);
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu", listens: [] } });
  });

  it("reports a rejected token as an authentication problem when there is no username to fall back on", async () => {
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz({ tokenOwner: null });
    expect(await loadListening()).toMatchObject({ status: "unavailable", reason: "auth" });
  });

  it("tries each candidate spelling in order and uses the first one ListenBrainz knows", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu-typo, hikemu-not-here, hkmu";
    stubListenBrainz();
    const result = await loadListening();
    expect(result).toMatchObject({ status: "ok", data: { account: "hkmu" } });
    expect(paths()).toContain("/1/user/nothikemu-typo/listens");
    expect(paths()).toContain("/1/user/hkmu/listens");
  });

  it("says which names it tried when ListenBrainz knows none of them", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nobody-here, nor-here";
    stubListenBrainz();
    const result = await loadListening();
    expect(result).toMatchObject({ status: "unavailable", reason: "not-found" });
    expect(result.status === "unavailable" && result.detail).toContain('"nobody-here" or "nor-here"');
  });

  it("never moves on to another account because of a temporary error", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu, hkmu";
    stubListenBrainz({ failing: ["nothikemu"] });
    const result = await loadListening();
    expect(result).toMatchObject({ status: "unavailable", reason: "upstream" });
    expect(paths().some((path) => path.includes("/user/hkmu/"))).toBe(false);
  });

  it("accepts any Unicode username and encodes it into the path", async () => {
    process.env.LISTENBRAINZ_USERNAME = "ひかる_01";
    stubListenBrainz();
    expect((await loadListening()).status).toBe("ok");
    expect(requests.some((r) => r.url.includes(`/user/${encodeURIComponent("ひかる_01")}/listens`))).toBe(true);
  });

  it("refuses a username that could change the request path, and says the setting was read but unusable", async () => {
    stubListenBrainz();
    for (const bad of ["a/b", "a?b", "a#b", "a%2fb", "a\nb", "a\\b"]) {
      clearCache();
      process.env.LISTENBRAINZ_USERNAME = bad;
      const result = await loadListening();
      expect(result, bad).toMatchObject({ status: "unavailable", reason: "bad-config" });
      expect(result.status === "unavailable" && result.detail).toContain("LISTENBRAINZ_USERNAME");
    }
    expect(requests).toHaveLength(0);
  });

  it("skips an unusable entry but still uses the usable ones around it", async () => {
    process.env.LISTENBRAINZ_USERNAME = "a/b, hkmu";
    stubListenBrainz();
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu" } });
  });

  it("prefers a spelling that has listens over one that exists but is empty", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu or hkmu";
    stubListenBrainz({ empty: ["nothikemu"] });
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu", listens: [{ title: "Song of hkmu" }] } });
  });

  it("falls back to the first real account when every spelling is empty", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu or hkmu";
    stubListenBrainz({ empty: ["nothikemu", "hkmu"] });
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "nothikemu", listens: [] } });
  });

  it("trusts the token's account even when it has no listens and a guessed spelling does", async () => {
    process.env.LISTENBRAINZ_USERNAME = "nothikemu";
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz({ tokenOwner: "tokenowner", known: ["tokenowner", "nothikemu"], empty: ["tokenowner"] });
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "tokenowner", listens: [] } });
  });

  it("combines names from the environment and from identity.ts instead of letting one hide the other", async () => {
    process.env.LISTENBRAINZ_USERNAME = "wrong-guess";
    identity.listenbrainzUsername = "hkmu";
    stubListenBrainz();
    expect(await loadListening()).toMatchObject({ status: "ok", data: { account: "hkmu" } });
  });

  it("does not present a stale 'now playing' track as playing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    let playing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        if (url.pathname.endsWith("/playing-now")) {
          return playing
            ? json({ payload: { count: 1, listens: [{ track_metadata: { artist_name: "Now Artist", track_name: "Now Song" } }] } })
            : json({ error: "down" }, 500);
        }
        return json({ payload: { count: 1, listens: [listen({ track_name: "Song" }, spotifyInfo)] } });
      }),
    );
    const first = await loadListening();
    expect(first).toMatchObject({ status: "ok", data: { nowPlaying: { title: "Now Song" } } });
    playing = false;
    vi.setSystemTime(new Date("2026-10-18T12:05:00Z"));
    const later = await loadListening();
    expect(later.status).toBe("ok");
    expect(later.status === "ok" && later.data.nowPlaying).toBeNull();
    vi.useRealTimers();
  });

  it("is unconfigured, not broken, with neither a username nor a token", async () => {
    stubListenBrainz();
    expect(await loadListening()).toEqual({ status: "missing-config", missing: ["LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN"] });
    expect(requests).toHaveLength(0);
  });
});

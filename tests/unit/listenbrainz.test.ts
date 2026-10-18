import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadListening, normalizeListens, normalizePlayingNow } from "@/data/listenbrainz";
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

describe("loadListening: which account is read", () => {
  const TOKEN = "11111111-2222-3333-4444-555555555555"; // made up for this test
  const requests: { url: string; authorization: string | null }[] = [];

  function stubListenBrainz(userName = "hkmu") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = new URL(String(input));
        requests.push({ url: url.href, authorization: new Headers(init.headers).get("authorization") });
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (url.pathname === "/1/validate-token") return json({ code: 200, message: "Token valid.", valid: true, user_name: userName });
        if (url.pathname.endsWith("/playing-now")) return json({ payload: { count: 0, playing_now: true, listens: [] } });
        return json({ payload: { count: 1, listens: [listen({ track_name: "Song" }, spotifyInfo)] } });
      }),
    );
  }

  beforeEach(() => {
    clearCache();
    requests.length = 0;
    delete process.env.LISTENBRAINZ_USERNAME;
    delete process.env.LISTENBRAINZ_TOKEN;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LISTENBRAINZ_USERNAME;
    delete process.env.LISTENBRAINZ_TOKEN;
  });

  it("reads a configured username directly, with no token and no authorization header", async () => {
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    stubListenBrainz();
    const result = await loadListening();
    expect(result).toMatchObject({ status: "ok", data: { listens: [{ title: "Song" }] } });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(expect.arrayContaining(["/1/user/hkmu/listens", "/1/user/hkmu/playing-now"]));
    expect(requests.some((r) => r.url.includes("validate-token"))).toBe(false);
    expect(requests.every((r) => r.authorization === null)).toBe(true);
  });

  it("prefers the username over a token, and never sends the token", async () => {
    process.env.LISTENBRAINZ_USERNAME = "hkmu";
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz();
    await loadListening();
    expect(requests.some((r) => r.url.includes("validate-token"))).toBe(false);
    expect(JSON.stringify(requests)).not.toContain(TOKEN);
  });

  it("with only a token, asks ListenBrainz whose it is once, then reads that account's public listens", async () => {
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    stubListenBrainz("tokenowner");
    expect((await loadListening()).status).toBe("ok");
    const validate = requests.filter((r) => r.url.includes("validate-token"));
    expect(validate).toHaveLength(1);
    expect(validate[0]!.authorization).toBe(`Token ${TOKEN}`);
    const reads = requests.filter((r) => !r.url.includes("validate-token"));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.authorization === null && r.url.includes("/user/tokenowner/"))).toBe(true);
    expect(JSON.stringify(await loadListening())).not.toContain(TOKEN);
  });

  it("accepts any Unicode username and encodes it into the path", async () => {
    process.env.LISTENBRAINZ_USERNAME = "ひかる_01";
    stubListenBrainz();
    expect((await loadListening()).status).toBe("ok");
    expect(requests.some((r) => r.url.includes(`/user/${encodeURIComponent("ひかる_01")}/listens`))).toBe(true);
  });

  it("refuses a username that could change the request path", async () => {
    stubListenBrainz();
    for (const bad of ["a/b", "a?b", "a#b", "a%2fb", "a\nb", "a\\b"]) {
      clearCache();
      process.env.LISTENBRAINZ_USERNAME = bad;
      expect(await loadListening()).toMatchObject({ status: "missing-config" });
    }
    expect(requests).toHaveLength(0);
  });

  it("is unconfigured, not broken, with neither a username nor a token", async () => {
    stubListenBrainz();
    expect(await loadListening()).toEqual({ status: "missing-config", missing: ["LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN"] });
    expect(requests).toHaveLength(0);
  });

  it("reports a rejected token as an authentication problem", async () => {
    process.env.LISTENBRAINZ_TOKEN = TOKEN;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 200, message: "Token invalid.", valid: false }), { status: 200 })));
    expect(await loadListening()).toMatchObject({ status: "unavailable", reason: "auth" });
  });
});

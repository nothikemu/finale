import { describe, expect, it } from "vitest";
import { normalizeListens, normalizePlayingNow } from "@/data/listenbrainz";

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

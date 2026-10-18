import "server-only";

import { z } from "zod";
import { cacheTtl } from "@/config/site";
import type { ListeningData, Listen, Loaded, Track } from "@/data/types";
import { cleanText, spotifyTrackUrl } from "@/lib/sanitize";
import { cached, toLoaded } from "@/lib/server/cache";
import { MissingConfigError, serverEnv, warnOnce } from "@/lib/server/env";
import { fetchUpstreamJson, UpstreamError } from "@/lib/server/http";

const API = "https://api.listenbrainz.org/1";
const HISTORY_COUNT = 50;
/** MusicBrainz usernames may be any Unicode text; only control characters and URL-structure characters are refused. */
const USERNAME = /^[^\p{C}/\\?#%]{1,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ListenBrainz sends explicit nulls for absent values, and a malformed optional
 * field should never cost us the whole listen, so optional fields fall back to
 * undefined on any mismatch.
 */
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().catch(undefined);

const additionalInfo = z
  .object({
    music_service: optional(z.string()),
    music_service_name: optional(z.string()),
    submission_client: optional(z.string()),
    spotify_id: optional(z.string()),
    origin_url: optional(z.string()),
  })
  .passthrough();

const trackMetadata = z.object({
  artist_name: z.string(),
  track_name: z.string(),
  release_name: optional(z.string()),
  additional_info: optional(additionalInfo),
  mbid_mapping: optional(z.object({ caa_id: optional(z.number()), caa_release_mbid: optional(z.string()) }).passthrough()),
});

const listenSchema = z.object({
  listened_at: z.number().int().positive().optional(),
  recording_msid: z.string().nullish(),
  track_metadata: trackMetadata,
});

const listensResponse = z.object({ payload: z.object({ listens: z.array(z.unknown()) }) });
const validateResponse = z.object({ valid: z.boolean(), user_name: z.string().optional() });

type RawListen = z.infer<typeof listenSchema>;

function isSpotifyOrigin(raw: RawListen): boolean {
  const info = raw.track_metadata.additional_info;
  if (!info) return false;
  const service = info.music_service?.toLowerCase();
  return (
    service === "spotify.com" ||
    service === "spotify" ||
    info.music_service_name?.toLowerCase() === "spotify" ||
    (info.submission_client?.toLowerCase().includes("spotify") ?? false) ||
    spotifyTrackUrl(info.spotify_id) !== null
  );
}

function artworkUrl(raw: RawListen): string | null {
  const mapping = raw.track_metadata.mbid_mapping;
  const id = mapping?.caa_id;
  const release = mapping?.caa_release_mbid;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !release || !UUID.test(release)) return null;
  return `https://coverartarchive.org/release/${release.toLowerCase()}/${id}-250.jpg`;
}

function toTrack(raw: RawListen, id: string): Track | null {
  const title = cleanText(raw.track_metadata.track_name, 200);
  const artist = cleanText(raw.track_metadata.artist_name, 200);
  if (!title || !artist) return null;
  const info = raw.track_metadata.additional_info;
  return {
    id,
    title,
    artist,
    album: cleanText(raw.track_metadata.release_name, 200),
    artworkUrl: artworkUrl(raw),
    // Only a canonical open.spotify.com track link is ever accepted.
    spotifyUrl: spotifyTrackUrl(info?.spotify_id) ?? spotifyTrackUrl(info?.origin_url),
  };
}

export interface NormalizedListens {
  listens: Listen[];
  spotifyOnly: boolean;
}

/**
 * Normalises a /listens payload. Entries that fail validation are skipped.
 * Only exact copies of the same event are collapsed, so repeat plays survive.
 * If ListenBrainz reliably marks any entry as Spotify-origin, only those are
 * kept; otherwise every listen is shown under the neutral label.
 */
export function normalizeListens(payload: unknown): NormalizedListens {
  const envelope = listensResponse.safeParse(payload);
  if (!envelope.success) throw new UpstreamError("invalid-response", "listenbrainz");

  const entries: { listen: Listen; spotify: boolean }[] = [];
  const seen = new Set<string>();
  for (const item of envelope.data.payload.listens) {
    const parsed = listenSchema.safeParse(item);
    if (!parsed.success || !parsed.data.listened_at) continue;
    const raw = parsed.data;
    const eventKey = `${raw.listened_at}|${raw.recording_msid ?? ""}|${raw.track_metadata.track_name}|${raw.track_metadata.artist_name}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const track = toTrack(raw, `${raw.listened_at}-${seen.size}`);
    if (!track) continue;
    entries.push({ listen: { ...track, listenedAt: (raw.listened_at as number) * 1000 }, spotify: isSpotifyOrigin(raw) });
  }

  entries.sort((a, b) => b.listen.listenedAt - a.listen.listenedAt);
  const spotifyEntries = entries.filter((entry) => entry.spotify);
  const spotifyOnly = spotifyEntries.length > 0 && spotifyEntries.length < entries.length;
  const chosen = spotifyEntries.length > 0 ? spotifyEntries : entries;
  return { listens: chosen.map((entry) => entry.listen), spotifyOnly };
}

export function normalizePlayingNow(payload: unknown): Track | null {
  const envelope = listensResponse.safeParse(payload);
  if (!envelope.success) return null;
  for (const item of envelope.data.payload.listens) {
    const parsed = listenSchema.safeParse(item);
    if (!parsed.success) continue;
    const track = toTrack(parsed.data, "now-playing");
    if (track) return track;
  }
  return null;
}

async function resolveUsername(): Promise<string> {
  const configured = serverEnv.listenbrainzUsername;
  if (configured) {
    if (!USERNAME.test(configured)) {
      warnOnce("lb-username", "LISTENBRAINZ_USERNAME contains unsupported characters.");
      throw new MissingConfigError(["LISTENBRAINZ_USERNAME"]);
    }
    return configured;
  }
  const token = serverEnv.listenbrainzToken;
  if (!token) {
    warnOnce("lb-token", "Neither LISTENBRAINZ_USERNAME nor LISTENBRAINZ_TOKEN is set; recent listening is unavailable.");
    throw new MissingConfigError(["LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN"]);
  }
  const result = await cached({
    key: "listenbrainz:username",
    ttlMs: cacheTtl.listenbrainzUsername,
    load: async () => {
      const { json } = await fetchUpstreamJson(`${API}/validate-token`, {
        service: "listenbrainz-token",
        init: { headers: { authorization: `Token ${token}` } },
      });
      const parsed = validateResponse.safeParse(json);
      if (!parsed.success) throw new UpstreamError("invalid-response", "listenbrainz-token");
      if (!parsed.data.valid || !parsed.data.user_name || !USERNAME.test(parsed.data.user_name)) {
        warnOnce("lb-token-invalid", "LISTENBRAINZ_TOKEN was rejected by ListenBrainz.");
        throw new UpstreamError("auth", "listenbrainz-token");
      }
      return parsed.data.user_name;
    },
  });
  return result.data;
}

async function fetchListens(username: string): Promise<NormalizedListens> {
  const { json } = await fetchUpstreamJson(`${API}/user/${encodeURIComponent(username)}/listens?count=${HISTORY_COUNT}`, {
    service: "listenbrainz",
  });
  return normalizeListens(json);
}

/** Optional: a failure here must never take down the history. */
async function fetchPlayingNow(username: string): Promise<Track | null> {
  try {
    const result = await cached({
      key: `listenbrainz:playing-now:${username}`,
      ttlMs: cacheTtl.nowPlaying,
      load: async () => {
        const { json } = await fetchUpstreamJson(`${API}/user/${encodeURIComponent(username)}/playing-now`, {
          service: "listenbrainz-playing-now",
          retries: 0,
          timeoutMs: 5000,
        });
        return normalizePlayingNow(json);
      },
    });
    return result.data;
  } catch {
    return null;
  }
}

export function loadListening(): Promise<Loaded<ListeningData>> {
  return toLoaded({
    // The outer entry keeps last-known-good history for stale serving.
    key: "listenbrainz:listening",
    ttlMs: cacheTtl.nowPlaying,
    load: async () => {
      const username = await resolveUsername();
      const [history, nowPlaying] = await Promise.all([
        cached({ key: `listenbrainz:listens:${username}`, ttlMs: cacheTtl.listens, load: () => fetchListens(username) }),
        fetchPlayingNow(username),
      ]);
      // A stale history means the refresh failed; fail this layer too so the
      // outer cache keeps serving (and flags) its last-known-good snapshot.
      if (history.stale) throw new UpstreamError("upstream", "listenbrainz");
      return { nowPlaying, listens: history.data.listens, spotifyOnly: history.data.spotifyOnly };
    },
  });
}

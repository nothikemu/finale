import { asBoolean, asFiniteNumber, asRecord, asString, oneOf, type UnknownRecord } from "@/lib/guards";
import { cleanMultiline, cleanText, safeHttpsUrl, spotifyTrackUrlFromId } from "@/lib/sanitize";
import { avatarUrl, bannerUrl, customEmojiUrl, isSnowflake, resolveActivityImage, spotifyThumbnail } from "./assets";
import { badgesFromPublicFlags } from "./badges";
import type { ActivityKind, ActivityView, CustomStatus, DiscordPresence, Platform, SpotifyActivity } from "./types";

const STATUSES = ["online", "idle", "dnd", "offline"] as const;

const ACTIVITY_KINDS: Record<number, ActivityKind> = {
  0: "playing",
  1: "streaming",
  2: "listening",
  3: "watching",
  5: "competing",
};

const CUSTOM_STATUS_TYPE = 4;
const MAX_ACTIVITIES = 6;

function timestamp(value: unknown): number | null {
  const n = asFiniteNumber(value);
  // Discord timestamps are epoch milliseconds.
  return n !== null && n > 1e11 ? n : null;
}

function parseTimestamps(raw: unknown): { start: number | null; end: number | null } {
  const rec = asRecord(raw);
  const start = timestamp(rec?.start);
  const end = timestamp(rec?.end);
  return { start, end: end !== null && start !== null && end <= start ? null : end };
}

function parseCustomStatus(activity: UnknownRecord): CustomStatus | null {
  const text = cleanText(activity.state, 128);
  const emoji = asRecord(activity.emoji);
  const emojiId = asString(emoji?.id);
  const emojiName = cleanText(emoji?.name, 32);
  const emojiUrl = emojiId ? customEmojiUrl(emojiId, asBoolean(emoji?.animated)) : null;
  const emojiText = emojiId ? null : emojiName;
  if (!text && !emojiText && !emojiUrl) return null;
  return { text, emojiText, emojiUrl };
}

function parseSpotify(raw: unknown): SpotifyActivity | null {
  const spotify = asRecord(raw);
  if (!spotify) return null;
  const track = cleanText(spotify.song, 200);
  const artist = cleanText(spotify.artist, 200);
  if (!track || !artist) return null;
  const { start, end } = parseTimestamps(spotify.timestamps);
  return {
    track,
    // Lanyard separates multiple artists with ";".
    artist: artist.replace(/\s*;\s*/g, ", "),
    album: cleanText(spotify.album, 200),
    artworkUrl: spotifyThumbnail(asString(spotify.album_art_url)),
    trackUrl: spotifyTrackUrlFromId(spotify.track_id),
    start,
    end,
  };
}

function parseActivity(raw: unknown): ActivityView | null {
  const activity = asRecord(raw);
  if (!activity) return null;
  const type = asFiniteNumber(activity.type);
  const kind = type === null ? undefined : ACTIVITY_KINDS[type];
  const name = cleanText(activity.name, 100);
  if (!kind || !name) return null;
  const assets = asRecord(activity.assets);
  const { start, end } = parseTimestamps(activity.timestamps);
  return {
    id: asString(activity.id) ?? `${kind}:${name}`,
    kind,
    name,
    details: cleanText(activity.details, 200),
    state: cleanText(activity.state, 200),
    imageUrl: resolveActivityImage(assets?.large_image, activity.application_id),
    start,
    end,
  };
}

/** The only Lanyard KV keys the owner approved for display. Everything else in KV is ignored. */
export interface KvKeys {
  bio?: string | null;
  banner?: string | null;
}

export interface ParseOptions {
  kv?: KvKeys;
}

const KV_KEY = /^[A-Za-z0-9_]{1,255}$/;

/** Reads one approved key from KV, and only if KV itself defines it (never an inherited member). */
function kvValue(kv: UnknownRecord | null, key: string | null | undefined): unknown {
  if (!kv || !key || key === "__proto__" || !KV_KEY.test(key)) return undefined;
  return Object.hasOwn(kv, key) ? kv[key] : undefined;
}

/**
 * Names the first thing wrong with a Lanyard presence payload: field names only, never values.
 * Lets owner diagnostics say "discord_user.id is not a Discord ID" instead of "something failed".
 */
export function presenceProblem(raw: unknown): string | null {
  const root = asRecord(raw);
  if (!root) return "the payload is not an object";
  const user = asRecord(root.discord_user);
  if (!user) return "discord_user is missing";
  const id = asString(user.id);
  if (!id || !isSnowflake(id)) return "discord_user.id is not a Discord ID";
  if (!cleanText(user.username, 64)) return "discord_user.username is missing";
  if (!oneOf(root.discord_status, STATUSES)) return "discord_status is not online, idle, dnd or offline";
  return null;
}

/**
 * Cheap shape check for a presence that this site's own server already validated and
 * normalised (`/api/presence`). The full validation happens once, on the server.
 */
export function isPresenceView(value: unknown): value is DiscordPresence {
  const view = asRecord(value);
  const user = asRecord(view?.user);
  return (
    view !== null &&
    user !== null &&
    typeof user.id === "string" &&
    typeof user.displayName === "string" &&
    typeof user.avatarUrl === "string" &&
    oneOf(view.status, STATUSES) !== null &&
    Array.isArray(view.badges) &&
    Array.isArray(view.platforms) &&
    Array.isArray(view.activities)
  );
}

/**
 * Validates and normalises a Lanyard presence object (REST `data` or the `d` of
 * a socket event). Returns null if it does not look like a presence at all, so
 * malformed payloads never reach the UI. Optional fields stay null unless the
 * source genuinely supplied them.
 */
export function parseLanyardPresence(raw: unknown, options: ParseOptions = {}): DiscordPresence | null {
  const root = asRecord(raw);
  const user = asRecord(root?.discord_user);
  if (!root || !user) return null;

  const id = asString(user.id);
  const username = cleanText(user.username, 64);
  const status = oneOf(root.discord_status, STATUSES);
  if (!id || !isSnowflake(id) || !username || !status) return null;

  const spotify = parseSpotify(root.spotify);
  const activities: ActivityView[] = [];
  let customStatus: CustomStatus | null = null;
  const rawActivities = Array.isArray(root.activities) ? root.activities : [];
  for (const item of rawActivities) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === CUSTOM_STATUS_TYPE) {
      customStatus ??= parseCustomStatus(rec);
      continue;
    }
    // Spotify is rendered from Lanyard's dedicated `spotify` field instead, but only when that field
    // gave a usable card; otherwise the generic activity (name, details, state) is the next best thing.
    if (rec.id === "spotify:1" && spotify !== null) continue;
    const parsed = parseActivity(rec);
    if (parsed && activities.length < MAX_ACTIVITIES) activities.push(parsed);
  }

  const platforms: Platform[] = [];
  if (asBoolean(root.active_on_discord_desktop)) platforms.push("desktop");
  if (asBoolean(root.active_on_discord_mobile)) platforms.push("mobile");
  if (asBoolean(root.active_on_discord_web)) platforms.push("web");

  const kv = asRecord(root.kv);
  const kvBio = cleanMultiline(kvValue(kv, options.kv?.bio), 300);
  // The owner controls this value, so any https image host is fine; scripts and plain http are not.
  const kvBanner = safeHttpsUrl(kvValue(kv, options.kv?.banner));
  const displayName = cleanText(user.global_name, 64) ?? cleanText(user.display_name, 64) ?? username;

  return {
    user: {
      id,
      username,
      displayName,
      avatarUrl: avatarUrl(id, asString(user.avatar), asString(user.discriminator)),
      // Precedence: a banner Discord/Lanyard actually returned, then the approved KV key.
      bannerUrl: bannerUrl(id, user.banner) ?? kvBanner,
      bio: cleanMultiline(user.bio, 300),
    },
    status,
    badges: badgesFromPublicFlags(user.public_flags),
    platforms,
    customStatus,
    spotify,
    activities,
    kvBio,
  };
}

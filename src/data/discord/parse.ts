import { asBoolean, asFiniteNumber, asRecord, asString, oneOf, type UnknownRecord } from "@/lib/guards";
import { cleanMultiline, cleanText } from "@/lib/sanitize";
import { spotifyTrackUrlFromId } from "@/lib/sanitize";
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

export interface ParseOptions {
  /** The one Lanyard KV key the owner approved for display, if any. */
  kvBioKey?: string | null;
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
    // Spotify is rendered from Lanyard's dedicated `spotify` field instead.
    if (rec.id === "spotify:1") continue;
    const parsed = parseActivity(rec);
    if (parsed && activities.length < MAX_ACTIVITIES) activities.push(parsed);
  }

  const platforms: Platform[] = [];
  if (asBoolean(root.active_on_discord_desktop)) platforms.push("desktop");
  if (asBoolean(root.active_on_discord_mobile)) platforms.push("mobile");
  if (asBoolean(root.active_on_discord_web)) platforms.push("web");

  const kv = asRecord(root.kv);
  const kvBio = options.kvBioKey ? cleanMultiline(kv?.[options.kvBioKey], 300) : null;
  const displayName = cleanText(user.global_name, 64) ?? cleanText(user.display_name, 64) ?? username;

  return {
    user: {
      id,
      username,
      displayName,
      avatarUrl: avatarUrl(id, asString(user.avatar), asString(user.discriminator)),
      bannerUrl: bannerUrl(id, user.banner),
      bio: cleanMultiline(user.bio, 300),
    },
    status,
    badges: badgesFromPublicFlags(user.public_flags),
    platforms,
    customStatus,
    spotify: parseSpotify(root.spotify),
    activities,
    kvBio,
  };
}

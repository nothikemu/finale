import { safeHttpsUrl } from "@/lib/sanitize";

/** Hosts Discord/Spotify artwork may come from. Anything else is dropped. */
export const ARTWORK_HOSTS = ["cdn.discordapp.com", "media.discordapp.net", "i.scdn.co"] as const;

const HASH = /^(a_)?[0-9a-f]{16,64}$/i;
const SNOWFLAKE = /^\d{15,25}$/;

export function isSnowflake(value: string): boolean {
  return SNOWFLAKE.test(value);
}

export function avatarUrl(userId: string, hash: string | null, discriminator: string | null): string {
  if (hash && HASH.test(hash)) {
    return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=128`;
  }
  // Discord's own default avatars: snowflake-derived for the new username system.
  let index: number;
  if (discriminator && discriminator !== "0" && /^\d{1,4}$/.test(discriminator)) {
    index = Number(discriminator) % 5;
  } else {
    index = Number((BigInt(userId) >> 22n) % 6n);
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function bannerUrl(userId: string, banner: unknown): string | null {
  if (typeof banner !== "string") return null;
  if (HASH.test(banner)) {
    return `https://cdn.discordapp.com/banners/${userId}/${banner}.${banner.startsWith("a_") ? "gif" : "png"}?size=480`;
  }
  return safeHttpsUrl(banner, { hosts: ARTWORK_HOSTS });
}

export function customEmojiUrl(id: string, animated: boolean): string | null {
  return SNOWFLAKE.test(id) ? `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=32` : null;
}

/**
 * Resolves a Rich Presence asset key to an image URL, or null when it cannot be
 * resolved safely (unknown scheme, unexpected host, malformed value).
 *
 * Discord asset keys come in a few shapes:
 *   mp:external/<hash>/<path>   -> media proxy
 *   mp:attachments/<ids>/<name> -> media proxy
 *   spotify:<image id>          -> Spotify CDN
 *   <numeric id>                -> application asset
 * youtube:/twitch: keys need other hosts and are deliberately not resolved.
 */
export function resolveActivityImage(asset: unknown, applicationId: unknown): string | null {
  if (typeof asset !== "string" || asset.length === 0 || asset.length > 1024) return null;

  if (asset.startsWith("mp:")) {
    const path = asset.slice(3);
    if (!/^(external|attachments)\//.test(path)) return null;
    return safeHttpsUrl(`https://media.discordapp.net/${path}`, { hosts: ["media.discordapp.net"] });
  }
  if (asset.startsWith("spotify:")) {
    const id = asset.slice(8);
    return /^[0-9a-f]{20,64}$/i.test(id) ? `https://i.scdn.co/image/${id}` : null;
  }
  if (/^\d{10,25}$/.test(asset) && typeof applicationId === "string" && SNOWFLAKE.test(applicationId)) {
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${asset}.png?size=128`;
  }
  return null;
}

/**
 * Lanyard serves Spotify art at 640px. Thumbnails here are 56px, so ask
 * Spotify's CDN for its 300px rendition of the same image when the id has the
 * known 640px prefix; any other URL is passed through unchanged.
 */
export function spotifyThumbnail(url: string | null): string | null {
  const safe = safeHttpsUrl(url, { hosts: ARTWORK_HOSTS });
  return safe ? safe.replace("/image/ab67616d0000b273", "/image/ab67616d00001e02") : null;
}

import type { DiscordPresence } from "./types";

/**
 * Where the profile bio and banner come from, most trusted first:
 *   1. a value Lanyard genuinely returned in the presence data,
 *   2. the owner-approved Lanyard KV key (already folded into `user.bannerUrl`
 *      for the banner, and exposed as `kvBio` for the bio),
 *   3. the owner's PROFILE_BIO / PROFILE_BANNER_URL environment fallback,
 *   4. nothing (the banner area then shows the quartz material, with no bio).
 * Custom status is never a bio.
 */
export function resolveBio(presence: DiscordPresence | null, fallbackBio: string | null): string | null {
  return presence ? (presence.user.bio ?? presence.kvBio ?? fallbackBio) : fallbackBio;
}

export function resolveBanner(presence: DiscordPresence | null, fallbackBanner: string | null): string | null {
  return presence?.user.bannerUrl ?? fallbackBanner;
}

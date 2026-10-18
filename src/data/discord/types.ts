/** Normalised Discord presence, derived only from fields Lanyard actually returned. */

export type DiscordStatus = "online" | "idle" | "dnd" | "offline";

export type ActivityKind = "playing" | "streaming" | "listening" | "watching" | "competing";

export interface DiscordBadge {
  key: string;
  label: string;
}

export interface CustomStatus {
  text: string | null;
  /** Unicode emoji text, or an image for custom emoji. */
  emojiText: string | null;
  emojiUrl: string | null;
}

export interface SpotifyActivity {
  track: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  trackUrl: string | null;
  /** Unix milliseconds. */
  start: number | null;
  end: number | null;
}

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  name: string;
  details: string | null;
  state: string | null;
  imageUrl: string | null;
  start: number | null;
  end: number | null;
}

export type Platform = "desktop" | "mobile" | "web";

export interface DiscordPresence {
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    /** Only set when Lanyard actually returns a banner. */
    bannerUrl: string | null;
    /** Only set when the data source actually returns a bio. */
    bio: string | null;
  };
  status: DiscordStatus;
  badges: DiscordBadge[];
  platforms: Platform[];
  customStatus: CustomStatus | null;
  spotify: SpotifyActivity | null;
  activities: ActivityView[];
  /** Value of the single owner-approved KV key, if configured and present. */
  kvBio: string | null;
}

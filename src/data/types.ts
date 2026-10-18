/** Clearly typed, normalised models shared by adapters and components. */

export type UnavailableReason = "rate-limited" | "auth" | "network" | "upstream" | "invalid-response";

/** Every data panel renders from one of these states. "Loading" is the Suspense fallback. */
export type Loaded<T> =
  | { status: "ok"; data: T; fetchedAt: number; stale: boolean }
  | { status: "missing-config"; missing: string[] }
  | {
      status: "unavailable";
      reason: UnavailableReason;
      /** Which service failed and how, e.g. "github-graphql: auth (401)". Never contains credentials. */
      detail?: string;
    };

export interface Track {
  /** Stable React key. */
  id: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  spotifyUrl: string | null;
}

export interface Listen extends Track {
  /** Unix milliseconds. */
  listenedAt: number;
}

export interface ListeningData {
  nowPlaying: Track | null;
  listens: Listen[];
  /** True when listens were narrowed to entries ListenBrainz identifies as Spotify. */
  spotifyOnly: boolean;
}

export interface Repository {
  id: number;
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  fork: boolean;
  /** ISO timestamp from GitHub's updated_at. */
  updatedAt: string;
}

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  level: ContributionLevel;
}

export interface ContributionCalendar {
  total: number;
  /** Weeks in chronological order, each with days in chronological order (Sunday first). */
  weeks: ContributionDay[][];
  from: string;
  to: string;
}

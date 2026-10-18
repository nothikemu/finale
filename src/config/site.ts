/**
 * Owner-editable site configuration. Secrets never live here; see .env.example.
 */

export type IconName = "x" | "github" | "link";

export interface SocialLink {
  id: string;
  /** Lowercase platform label as displayed. */
  label: string;
  /** Handle or path as displayed. */
  handle: string;
  href: string;
  icon: IconName;
}

export type FxName = "rocket" | "beats" | "enjoyer";

export interface AboutSegment {
  text: string;
  /** Wraps the segment in a decorative word effect. */
  fx?: FxName;
}

export const site = {
  title: "nothikemu",
  description: "nothikemu: live discord presence, recent listening, github activity and projects.",
  githubUsername: "nothikemu",

  socials: [
    { id: "twitter", label: "twitter / x", handle: "@nothikemu", href: "https://twitter.com/nothikemu", icon: "x" },
    { id: "github", label: "github", handle: "@nothikemu", href: "https://github.com/nothikemu", icon: "github" },
    { id: "gunslol", label: "guns.lol", handle: "/hkmu", href: "https://guns.lol/hkmu", icon: "link" },
  ] satisfies SocialLink[],

  /** Copy is intentionally lowercase and must not be reworded. */
  about: [
    [{ text: "mechanical engineering student" }],
    [{ text: "avid model " }, { text: "rocket", fx: "rocket" }, { text: " maker" }],
    [{ text: "i make " }, { text: "beats", fx: "beats" }, { text: " in my free time" }],
    [{ text: "thorough " }, { text: "enjoyer", fx: "enjoyer" }, { text: " of fiddling with computers" }],
  ] satisfies AboutSegment[][],

  discord: {
    /**
     * Optional, explicitly approved Lanyard KV key whose value is shown as the
     * bio. KV values are public, so only this one key is ever read. Leave null
     * to ignore KV entirely.
     */
    kvBioKey: null as string | null,
  },

  /**
   * "auto" uses backdrop blur where supported. "opaque" forces solid panels
   * everywhere. Users who prefer reduced transparency always get solid panels.
   */
  glass: "auto" as "auto" | "opaque",
};

/** Server-side cache lifetimes in milliseconds. */
export const cacheTtl = {
  listens: 60_000,
  nowPlaying: 20_000,
  listenbrainzUsername: 6 * 60 * 60_000,
  contributions: 30 * 60_000,
  projects: 15 * 60_000,
} as const;

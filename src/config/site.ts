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
     * Lanyard only relays Discord's gateway presence, which has no banner or
     * "About Me". Its key-value store is the supported way to publish them: set
     * the keys below with the Lanyard bot and they are read from the same
     * presence feed. KV values are public, so ONLY the keys named here are ever
     * read (never the whole object). Set a key to null to ignore it.
     *
     *   bio    plain text, up to 300 characters
     *   banner an https:// image URL
     */
    kv: { bio: "bio", banner: "banner" } as { bio: string | null; banner: string | null },
  },

  github: {
    /**
     * The calendar's primary source is GitHub's GraphQL API (needs GITHUB_TOKEN).
     * If that is unavailable (no token, or a token GitHub rejects) the site falls
     * back to the public contributions graph that github.com serves to anyone,
     * which shows the same public data. Set to false to use GraphQL only.
     */
    publicCalendarFallback: true,
  },

  /**
   * "auto" uses backdrop blur where supported. "opaque" forces solid panels
   * everywhere. Users who prefer reduced transparency always get solid panels.
   */
  glass: "auto" as "auto" | "opaque",

  /**
   * Stops casual copying: text cannot be selected, and right-click, copy, cut and dragging are
   * blocked. It is a deterrent only: view-source, developer tools and screenshots still work, and
   * it also stops visitors who want to select text for a translator or a reading aid. Set to
   * false to allow normal selecting and copying.
   */
  protectContent: true,
};

/** Server-side cache lifetimes in milliseconds. */
export const cacheTtl = {
  /** Discord presence snapshot for browsers that cannot reach Lanyard themselves. */
  presence: 10_000,
  listens: 60_000,
  nowPlaying: 20_000,
  listenbrainzUsername: 6 * 60 * 60_000,
  contributions: 30 * 60_000,
  projects: 15 * 60_000,
} as const;

import type { DiscordBadge } from "./types";

/**
 * Discord public_flags bits that map to a user-visible profile badge.
 * Nitro and server boosting are not part of public_flags, so they are never shown.
 */
const PUBLIC_FLAG_BADGES: readonly { bit: number; key: string; label: string }[] = [
  { bit: 1 << 0, key: "staff", label: "discord staff" },
  { bit: 1 << 1, key: "partner", label: "partnered server owner" },
  { bit: 1 << 2, key: "hypesquad-events", label: "hypesquad events" },
  { bit: 1 << 3, key: "bug-hunter-1", label: "bug hunter" },
  { bit: 1 << 6, key: "hypesquad-bravery", label: "hypesquad bravery" },
  { bit: 1 << 7, key: "hypesquad-brilliance", label: "hypesquad brilliance" },
  { bit: 1 << 8, key: "hypesquad-balance", label: "hypesquad balance" },
  { bit: 1 << 9, key: "early-supporter", label: "early supporter" },
  { bit: 1 << 14, key: "bug-hunter-2", label: "bug hunter gold" },
  { bit: 1 << 17, key: "verified-developer", label: "early verified bot developer" },
  { bit: 1 << 18, key: "certified-moderator", label: "moderator programs alumni" },
  { bit: 1 << 22, key: "active-developer", label: "active developer" },
];

export function badgesFromPublicFlags(flags: unknown): DiscordBadge[] {
  if (typeof flags !== "number" || !Number.isInteger(flags) || flags <= 0) return [];
  return PUBLIC_FLAG_BADGES.filter(({ bit }) => (flags & bit) !== 0).map(({ key, label }) => ({ key, label }));
}

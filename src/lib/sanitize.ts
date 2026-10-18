/**
 * Defensive normalisation for text and URLs that originate outside this repo.
 * Everything is rendered through React text nodes (never as HTML); these helpers
 * additionally strip invisible/bidi control characters and enforce URL rules.
 */

// C0/C1 controls (minus tab/newline), zero-width space, bidi marks/embeddings/
// overrides/isolates, word joiner and BOM. ZWJ/ZWNJ are kept so emoji sequences survive.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;

function clamp(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

/** Single-line text: collapses whitespace. Returns null when empty or not a string. */
export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return text ? clamp(text, max) : null;
}

/** Multi-line text: keeps single line breaks, collapses runs of blank lines. */
export function cleanMultiline(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? clamp(text, max) : null;
}

export interface SafeUrlOptions {
  /** Exact hostnames, or hostnames written as "*.example.com" for subdomains. */
  hosts?: readonly string[];
}

function hostAllowed(hostname: string, hosts: readonly string[]): boolean {
  return hosts.some((allowed) =>
    allowed.startsWith("*.") ? hostname.endsWith(allowed.slice(1)) && hostname.length > allowed.length - 1 : hostname === allowed,
  );
}

/** Returns a normalised https URL without credentials, or null. */
export function safeHttpsUrl(value: unknown, options: SafeUrlOptions = {}): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (options.hosts && !hostAllowed(url.hostname.toLowerCase(), options.hosts)) return null;
  return url.href;
}

const SPOTIFY_TRACK = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,3}(?:-[a-z]{2,4})?\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/;

/** Canonical https://open.spotify.com/track/<id> URL, or null. */
export function spotifyTrackUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = SPOTIFY_TRACK.exec(value.trim());
  return match ? `https://open.spotify.com/track/${match[1]}` : null;
}

export function spotifyTrackUrlFromId(id: unknown): string | null {
  return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? `https://open.spotify.com/track/${id}` : null;
}

import "server-only";

import { identity } from "@/config/identity";

/**
 * Server-side configuration. Values are read lazily so tests and hosts that
 * inject env at runtime behave. Nothing returned here may reach the browser
 * except DISCORD_USER_ID and the owner-supplied profile fallbacks.
 *
 * Public identifiers (Discord ID, ListenBrainz username) and the diagnostics
 * switch may also come from src/config/identity.ts, for hosts that never
 * receive .env.local. An environment variable always wins. Credentials are
 * environment-only.
 */

const PLACEHOLDER = /^(replace[_-]?with|your[_-]|changeme|todo$|xxx+$)/i;

/** Characters that survive copy-paste but are invisible: zero-width spaces and marks, word joiner, BOM. */
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF]/g;
/** Straight and typographic quotes that end up around a value pasted from a chat or a document. */
const WRAPPING_QUOTES = /^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g;

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.replace(INVISIBLE, "").trim().replace(WRAPPING_QUOTES, "").trim();
  return trimmed && !PLACEHOLDER.test(trimmed) ? trimmed : undefined;
}

function read(name: string): string | undefined {
  return clean(process.env[name]);
}

const flag = (value: string | null | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
const flagOff = (value: string | null | undefined) => /^(0|false|no|off)$/i.test(value?.trim() ?? "");

export const serverEnv = {
  get discordUserId() {
    return read("DISCORD_USER_ID") ?? clean(identity.discordUserId);
  },
  get listenbrainzToken() {
    return read("LISTENBRAINZ_TOKEN");
  },
  /** Names from the environment first, then from identity.ts: both are candidate spellings. */
  get listenbrainzUsername() {
    const names = [read("LISTENBRAINZ_USERNAME"), clean(identity.listenbrainzUsername)].filter(Boolean);
    return names.length > 0 ? names.join(",") : undefined;
  },
  get githubToken() {
    return read("GITHUB_TOKEN");
  },
  get profileBannerUrl() {
    return read("PROFILE_BANNER_URL");
  },
  get profileBio() {
    return read("PROFILE_BIO");
  },
  /**
   * What the owner said about diagnostics: true (SHOW_DIAGNOSTICS=1, or showDiagnostics in
   * identity.ts), false (SHOW_DIAGNOSTICS=0: never, not even on localhost), or undefined.
   * An environment variable wins over the file.
   */
  get diagnosticsSetting(): boolean | undefined {
    if (flag(process.env.SHOW_DIAGNOSTICS)) return true;
    if (flagOff(process.env.SHOW_DIAGNOSTICS)) return false;
    return identity.showDiagnostics === true ? true : undefined;
  },
  /** Opt in to showing setup/failure hints (and /status) in production builds too. */
  get showDiagnostics() {
    return this.diagnosticsSetting === true;
  },
};

export type ConfigSource = "environment" | "src/config/identity.ts" | "not set";

/** Where a setting comes from, for owner diagnostics. Never returns a value. */
export function configSource(name: "DISCORD_USER_ID" | "LISTENBRAINZ_USERNAME" | "LISTENBRAINZ_TOKEN" | "GITHUB_TOKEN" | "SHOW_DIAGNOSTICS"): ConfigSource {
  if (name === "SHOW_DIAGNOSTICS") {
    if (flag(process.env.SHOW_DIAGNOSTICS) || flagOff(process.env.SHOW_DIAGNOSTICS)) return "environment";
    return identity.showDiagnostics === true ? "src/config/identity.ts" : "not set";
  }
  if (read(name)) return "environment";
  if (name === "DISCORD_USER_ID" && clean(identity.discordUserId)) return "src/config/identity.ts";
  if (name === "LISTENBRAINZ_USERNAME" && clean(identity.listenbrainzUsername)) return "src/config/identity.ts";
  return "not set";
}

export class MissingConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`missing configuration: ${missing.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

/** See isUpstreamError: recognised by shape, because each route bundle has its own copy of the class. */
export function isMissingConfigError(error: unknown): error is MissingConfigError {
  return error instanceof MissingConfigError || (error instanceof Error && error.name === "MissingConfigError" && Array.isArray((error as { missing?: unknown }).missing));
}

const warned = new Set<string>();

/** Logs a configuration problem once per process. Never logs values. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[config] ${message}`);
}

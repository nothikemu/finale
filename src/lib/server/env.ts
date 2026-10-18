import "server-only";

/**
 * Server-side configuration. Values are read lazily so tests and hosts that
 * inject env at runtime behave. Nothing returned here may reach the browser
 * except DISCORD_USER_ID and the owner-supplied profile fallbacks.
 */

const PLACEHOLDER = /^(replace[_-]?with|your[_-]|changeme|todo$|xxx+$)/i;

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !PLACEHOLDER.test(value) ? value : undefined;
}

export const serverEnv = {
  get discordUserId() {
    return read("DISCORD_USER_ID");
  },
  get listenbrainzToken() {
    return read("LISTENBRAINZ_TOKEN");
  },
  get listenbrainzUsername() {
    return read("LISTENBRAINZ_USERNAME");
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
};

export class MissingConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`missing configuration: ${missing.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

const warned = new Set<string>();

/** Logs a configuration problem once per process. Never logs values. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[config] ${message}`);
}

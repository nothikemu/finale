/** Deliberately recognisable fake secrets, so tests can prove they never leak. */
export const FAKE_SECRETS = {
  GITHUB_TOKEN: "fake-github-token-for-e2e-0001",
  LISTENBRAINZ_TOKEN: "fake-listenbrainz-token-for-e2e-0002",
} as const;

/** Not the owner's ID: a made-up snowflake used only by tests. */
export const TEST_DISCORD_ID = "100000000000000001";

export const URLS = {
  /** everything configured, healthy upstreams */
  healthy: "http://localhost:3101",
  /** nothing configured, and github.com's public contributions page is blocked */
  unconfigured: "http://localhost:3102",
  /** every upstream fails; production defaults (no owner hints) */
  outage: "http://localhost:3103",
  /** GITHUB_TOKEN is set but GitHub rejects it (401), owner hints on */
  badToken: "http://localhost:3104",
  /** every upstream fails and SHOW_DIAGNOSTICS=1, so panels explain why */
  outageDiagnostics: "http://localhost:3105",
  /** no credentials at all, but GitHub's public pages work */
  publicOnly: "http://localhost:3106",
  /** healthy, and the server (not the browser) can reach Lanyard; owner hints on */
  serverLanyard: "http://localhost:3107",
  /** nothing configured, owner diagnostics on */
  unconfiguredDiagnostics: "http://localhost:3108",
  /** nothing configured, SHOW_DIAGNOSTICS unset: hints appear only for a viewer on localhost */
  localViewer: "http://localhost:3109",
  /** ListenBrainz configured with a list of guessed usernames, one of them real; its listens are mixed */
  guessedUsernames: "http://localhost:3110",
  /** ListenBrainz unreachable (network), owner diagnostics on */
  listenbrainzBlocked: "http://localhost:3111",
} as const;

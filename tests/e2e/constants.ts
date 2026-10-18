/** Deliberately recognisable fake secrets, so tests can prove they never leak. */
export const FAKE_SECRETS = {
  GITHUB_TOKEN: "fake-github-token-for-e2e-0001",
  LISTENBRAINZ_TOKEN: "fake-listenbrainz-token-for-e2e-0002",
} as const;

/** Not the owner's ID: a made-up snowflake used only by tests. */
export const TEST_DISCORD_ID = "100000000000000001";

export const URLS = {
  healthy: "http://localhost:3101",
  unconfigured: "http://localhost:3102",
  outage: "http://localhost:3103",
} as const;

import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { FAKE_SECRETS, TEST_DISCORD_ID } from "./tests/e2e/constants";

/**
 * End-to-end acceptance tests run against `next start` (a production build) on
 * eleven ports so every state of the dashboard can be exercised without network
 * access or real credentials:
 *
 *   3101  healthy upstreams (fixtures) and every secret configured
 *   3102  nothing configured, and github.com's public contributions page is blocked
 *   3103  every GitHub and ListenBrainz call fails (production defaults)
 *   3104  a GITHUB_TOKEN that GitHub rejects with 401, owner diagnostics on
 *   3105  every call fails and SHOW_DIAGNOSTICS=1, so panels explain why
 *   3106  no credentials at all, but GitHub's public pages work
 *   3107  healthy, and the server (not the browser) can reach Lanyard
 *   3108  nothing configured, owner diagnostics on: what an owner sees when their config never arrives
 *   3109  nothing configured, SHOW_DIAGNOSTICS left unset: nothing a client sends may unlock owner information
 *   3110  ListenBrainz configured with only a list of guessed usernames, one of them real
 *   3111  ListenBrainz unreachable (network), owner diagnostics on: the same cause must show in the page, the API and /status
 *
 * Every other server sets SHOW_DIAGNOSTICS=0 so that, although the tests browse from localhost, they
 * see what a remote visitor sees.
 *
 * The upstream fixtures live in tests/e2e/fixtures and are preloaded into the
 * server process with NODE_OPTIONS. They are test-only; see that file.
 * Run `npm run test:e2e` (it builds first).
 */

const preload = `--import ${path.join(__dirname, "tests/e2e/fixtures/upstream-preload.mjs")}`;

const blank = { DISCORD_USER_ID: "", LISTENBRAINZ_TOKEN: "", LISTENBRAINZ_USERNAME: "", GITHUB_TOKEN: "", PROFILE_BANNER_URL: "", PROFILE_BIO: "", SHOW_DIAGNOSTICS: "0", LANYARD_FIXTURE: "", LISTENBRAINZ_FIXTURE: "" };

function server(port: number, env: Record<string, string>) {
  return {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    // Opt in (PW_REUSE=1) to reuse servers you started yourself; by default stale ones are never trusted.
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: 60_000,
    env: { ...blank, NODE_OPTIONS: preload, ...env },
  };
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: "http://localhost:3101" },
  webServer: [
    server(3101, {
      FIXTURE_MODE: "ok",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
      PROFILE_BIO: "owner-supplied bio fallback",
    }),
    server(3102, { FIXTURE_MODE: "ok-no-public" }),
    server(3103, {
      FIXTURE_MODE: "down",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
    }),
    server(3104, {
      FIXTURE_MODE: "badtoken",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
      SHOW_DIAGNOSTICS: "1",
    }),
    server(3105, {
      FIXTURE_MODE: "down",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
      SHOW_DIAGNOSTICS: "1",
    }),
    server(3106, { FIXTURE_MODE: "ok" }),
    server(3107, {
      FIXTURE_MODE: "ok",
      LANYARD_FIXTURE: "ok",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
      SHOW_DIAGNOSTICS: "1",
    }),
    server(3108, { FIXTURE_MODE: "ok-no-public", SHOW_DIAGNOSTICS: "1" }),
    server(3109, { FIXTURE_MODE: "ok-no-public", SHOW_DIAGNOSTICS: "" }),
    server(3110, { FIXTURE_MODE: "ok", LISTENBRAINZ_USERNAME: "not-a-user or fixture-mixed", SHOW_DIAGNOSTICS: "1" }),
    server(3111, { FIXTURE_MODE: "ok", LISTENBRAINZ_FIXTURE: "blocked", LISTENBRAINZ_USERNAME: "fixture-user", SHOW_DIAGNOSTICS: "1" }),
  ],
});

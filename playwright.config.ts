import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { FAKE_SECRETS, TEST_DISCORD_ID } from "./tests/e2e/constants";

/**
 * End-to-end acceptance tests run against `next start` (a production build) on
 * three ports so every state of the dashboard can be exercised without network
 * access or real credentials:
 *
 *   3101  healthy upstreams (fixtures) and every secret configured
 *   3102  healthy upstreams, but no Discord ID / ListenBrainz / GitHub token
 *   3103  every GitHub and ListenBrainz call fails
 *
 * The upstream fixtures live in tests/e2e/fixtures and are preloaded into the
 * server process with NODE_OPTIONS. They are test-only; see that file.
 * Run `npm run test:e2e` (it builds first).
 */

const preload = `--import ${path.join(__dirname, "tests/e2e/fixtures/upstream-preload.mjs")}`;

const blank = { DISCORD_USER_ID: "", LISTENBRAINZ_TOKEN: "", LISTENBRAINZ_USERNAME: "", GITHUB_TOKEN: "", PROFILE_BANNER_URL: "", PROFILE_BIO: "" };

function server(port: number, env: Record<string, string>) {
  return {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
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
    server(3102, { FIXTURE_MODE: "ok" }),
    server(3103, {
      FIXTURE_MODE: "down",
      DISCORD_USER_ID: TEST_DISCORD_ID,
      GITHUB_TOKEN: FAKE_SECRETS.GITHUB_TOKEN,
      LISTENBRAINZ_TOKEN: FAKE_SECRETS.LISTENBRAINZ_TOKEN,
    }),
  ],
});

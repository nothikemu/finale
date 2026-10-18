import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_SECRETS, TEST_DISCORD_ID } from "./constants";

/**
 * `npm run doctor` against the fixture world (no network). Each case runs in a
 * fresh temporary folder, so it never reads the repository's own .env.local.
 */

const root = path.resolve(__dirname, "../..");
const preload = path.join(root, "tests/e2e/fixtures/upstream-preload.mjs");

function doctor(options: { env?: Record<string, string>; envFile?: string; mode?: string } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "doctor-"));
  if (options.envFile) writeFileSync(path.join(cwd, ".env.local"), options.envFile);
  const result = spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/doctor.mjs")], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", FIXTURE_MODE: options.mode ?? "ok", LANYARD_FIXTURE: "ok", NO_COLOR: "1", ...options.env },
    timeout: 60_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const CONFIGURED = [
  `DISCORD_USER_ID=${TEST_DISCORD_ID}`,
  `LISTENBRAINZ_TOKEN=11111111-2222-4333-8444-555555555555`, // a made-up UUID-shaped placeholder
  `GITHUB_TOKEN=${FAKE_SECRETS.GITHUB_TOKEN}`,
].join("\n");

test("everything healthy: all sections pass, exit 0, secrets never printed", async () => {
  const { status, out } = doctor({ envFile: CONFIGURED });
  expect(out).toContain("environment files found: .env.local");
  expect(out).toMatch(/PASS\s+Lanyard is tracking this account/);
  expect(out).toMatch(/PASS\s+token is valid/);
  expect(out).toMatch(/PASS\s+50 recent listens found/);
  expect(out).toMatch(/PASS\s+40 public repositories found/);
  expect(out).toMatch(/PASS\s+GraphQL works/);
  expect(out).toMatch(/PASS\s+public contributions graph available/);
  expect(out).toContain("Everything the site needs is reachable");
  expect(out).not.toContain("FAIL");
  expect(status).toBe(0);
  for (const secret of [...Object.values(FAKE_SECRETS), "11111111-2222-4333-8444-555555555555"]) expect(out).not.toContain(secret);
});

test("no environment file: it says so, and which variables the panels need", async () => {
  const { status, out } = doctor();
  expect(out).toMatch(/FAIL\s+no \.env\.local/);
  expect(out).toContain("ls -a"); // dotfiles are hidden in file managers
  expect(out).toMatch(/FAIL\s+DISCORD_USER_ID is not set/);
  expect(out).toMatch(/FAIL\s+neither LISTENBRAINZ_TOKEN nor LISTENBRAINZ_USERNAME/);
  expect(out).toMatch(/WARN\s+GITHUB_TOKEN is not set/);
  // GitHub's public data needs no token, so those checks still pass
  expect(out).toMatch(/PASS\s+40 public repositories found/);
  expect(out).toMatch(/PASS\s+public contributions graph available/);
  expect(status).toBe(1);
});

test("a rejected GitHub token is diagnosed, and the fallback is reported as working", async () => {
  const { status, out } = doctor({ envFile: CONFIGURED, mode: "badtoken" });
  expect(out).toMatch(/WARN\s+GitHub rejected GITHUB_TOKEN \(401/);
  expect(out).toContain("create a new fine-grained token");
  expect(out).toMatch(/PASS\s+40 public repositories found/);
  expect(out).toMatch(/PASS\s+public contributions graph available/);
  expect(status).toBe(0);
  expect(out).not.toContain(FAKE_SECRETS.GITHUB_TOKEN);
});

test("an untracked Discord account is explained", async () => {
  const { status, out } = doctor({ envFile: CONFIGURED.replace(TEST_DISCORD_ID, "200000000000000002") });
  expect(out).toMatch(/FAIL\s+Lanyard does not track this Discord account/);
  expect(out).toContain("https://discord.gg/UrXF2cfJ7F");
  expect(status).toBe(1);
});

test("a malformed Discord ID and a malformed token are caught before any request", async () => {
  const { out } = doctor({ envFile: ["DISCORD_USER_ID=not-a-number", "LISTENBRAINZ_TOKEN=abc", "GITHUB_TOKEN=short"].join("\n") });
  expect(out).toMatch(/FAIL\s+DISCORD_USER_ID is set but is not a numeric Discord ID/);
  expect(out).toMatch(/WARN\s+LISTENBRAINZ_TOKEN is set but is not in the usual UUID format/);
  expect(out).toMatch(/WARN\s+GITHUB_TOKEN is set but does not look like a GitHub token/);
});

test("upstreams down: every integration is reported with its own failure", async () => {
  const { status, out } = doctor({ envFile: CONFIGURED, mode: "down" });
  expect(out).toMatch(/FAIL\s+ListenBrainz rejected the token \(HTTP 500/);
  expect(out).toMatch(/FAIL\s+GitHub answered HTTP 500 for the repository list/);
  expect(status).toBe(1);
});

test("a username can replace the token for ListenBrainz", async () => {
  const { out } = doctor({ envFile: ["DISCORD_USER_ID=" + TEST_DISCORD_ID, "LISTENBRAINZ_USERNAME=fixture-user"].join("\n") });
  expect(out).toMatch(/PASS\s+LISTENBRAINZ_USERNAME is set/);
  expect(out).toMatch(/PASS\s+50 recent listens found/);
});

test("with no fixtures it classifies a network failure instead of crashing", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "doctor-net-"));
  writeFileSync(path.join(cwd, ".env.local"), CONFIGURED);
  // no preload: real fetch to unreachable hosts (this sandbox blocks them; elsewhere it may succeed, so only assert it terminates cleanly)
  const result = spawnSync(process.execPath, [path.join(root, "scripts/doctor.mjs")], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", NO_COLOR: "1" }, timeout: 120_000 });
  expect(result.stdout).toContain("Summary");
  expect(result.stderr).not.toMatch(/TypeError|ReferenceError|Unhandled/);
  expect(`${result.stdout}`).not.toContain(FAKE_SECRETS.GITHUB_TOKEN);
});

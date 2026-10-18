import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

function doctor(options: { env?: Record<string, string>; envFile?: string | Buffer; files?: Record<string, string>; identityFile?: string; mode?: string } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "doctor-"));
  if (options.envFile) writeFileSync(path.join(cwd, ".env.local"), options.envFile);
  for (const [name, contents] of Object.entries(options.files ?? {})) writeFileSync(path.join(cwd, name), contents);
  if (options.identityFile) {
    mkdirSync(path.join(cwd, "src/config"), { recursive: true });
    writeFileSync(path.join(cwd, "src/config/identity.ts"), options.identityFile);
  }
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

const DEAD_TOKEN = "00000000-0000-4000-8000-000000000000"; // the fixture answers 'valid: false' for this one
const ENV_BASE = `DISCORD_USER_ID=${TEST_DISCORD_ID}`;

test("a valid token reveals the ListenBrainz username, which answers 'I forgot it'", async () => {
  const { out } = doctor({ envFile: [ENV_BASE, `LISTENBRAINZ_TOKEN=11111111-2222-4333-8444-555555555555`].join("\n") });
  expect(out).toMatch(/PASS\s+token is valid \(ListenBrainz user: fixture-user\)/);
  expect(out).toContain('your ListenBrainz username is "fixture-user"');
});

test("a reset token does not take ListenBrainz down while a username is set", async () => {
  const { out, status } = doctor({ envFile: [ENV_BASE, `LISTENBRAINZ_TOKEN=${DEAD_TOKEN}`, "LISTENBRAINZ_USERNAME=fixture-user"].join("\n") });
  expect(out).toMatch(/WARN\s+ListenBrainz rejected the token .*the site will use the username instead/);
  expect(out).toMatch(/PASS\s+50 recent listens found for "fixture-user"/);
  expect(status).toBe(0);
});

test("a reset token with no username is a clear failure that says how to recover", async () => {
  const { out, status } = doctor({ envFile: [ENV_BASE, `LISTENBRAINZ_TOKEN=${DEAD_TOKEN}`].join("\n") });
  expect(out).toMatch(/FAIL\s+ListenBrainz rejected the token/);
  expect(out).toContain("set LISTENBRAINZ_USERNAME (public listens need no token)");
  expect(status).toBe(1);
});

test("several guessed usernames are tried in order and the first real one is used", async () => {
  const { out } = doctor({ envFile: [ENV_BASE, "LISTENBRAINZ_USERNAME=not-a-user, fixture-user"].join("\n") });
  expect(out).toContain('ListenBrainz has no user named "not-a-user"; trying the next one');
  expect(out).toMatch(/PASS\s+50 recent listens found for "fixture-user"/);
});

test("when no guess exists, every name that was tried is listed", async () => {
  const { out, status } = doctor({ envFile: [ENV_BASE, "LISTENBRAINZ_USERNAME=nope-one,nope-two"].join("\n") });
  expect(out).toMatch(/FAIL\s+ListenBrainz has no user named "nope-one" or "nope-two"/);
  expect(out).toContain("listenbrainz.org/user/<name>");
  expect(status).toBe(1);
});

test("values in src/config/identity.ts count, so a host that ignores .env.local still works", async () => {
  const identityFile = `export const identity = {
  discordUserId: "${TEST_DISCORD_ID}" as string | null,
  listenbrainzUsername: "not-a-user,fixture-user" as string | null,
  showDiagnostics: true,
};
`;
  const { out } = doctor({ identityFile });
  expect(out).toMatch(/PASS\s+discordUserId in src\/config\/identity\.ts is set and looks like a Discord ID/);
  expect(out).toMatch(/PASS\s+listenbrainzUsername in src\/config\/identity\.ts is set/);
  expect(out).toMatch(/PASS\s+Lanyard is tracking this account/);
  expect(out).toMatch(/PASS\s+50 recent listens found for "fixture-user"/);
});

test("an untouched identity.ts leaves things unset, as before", async () => {
  const identityFile = `export const identity = {\n  discordUserId: null as string | null,\n  listenbrainzUsername: null as string | null,\n  showDiagnostics: false,\n};\n`;
  const { out } = doctor({ identityFile });
  expect(out).toMatch(/FAIL\s+DISCORD_USER_ID is not set/);
  expect(out).toMatch(/FAIL\s+neither LISTENBRAINZ_TOKEN nor LISTENBRAINZ_USERNAME is set/);
});

test("an .env.local saved as UTF-16 is called out, since every variable in it is silently ignored", async () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${ENV_BASE}\r\nLISTENBRAINZ_USERNAME=fixture-user\r\n`, "utf16le")]);
  const { out, status } = doctor({ envFile: bytes });
  expect(out).toMatch(/FAIL\s+\.env\.local is saved as UTF-16/);
  expect(out).toContain("Encoding: UTF-8");
  expect(out).toMatch(/FAIL\s+DISCORD_USER_ID is not set/);
  expect(status).toBe(1);
});

test("a file named .env.local.txt (Explorer hides the extension) is recognised as the likely mistake", async () => {
  const { out } = doctor({ files: { ".env.local.txt": ENV_BASE } });
  expect(out).toMatch(/FAIL\s+no \.env\.local in this folder, but these look like it: \.env\.local\.txt/);
  expect(out).toContain("rename it to exactly .env.local");
});

test("the folder it looked in is printed, so a file in the wrong place is obvious", async () => {
  const { out } = doctor({ envFile: ENV_BASE });
  expect(out).toMatch(/looked in \S*doctor-/);
});

test("an empty .env.local and one with no readable lines are both reported", async () => {
  expect(doctor({ envFile: "# only a comment\n" }).out).toMatch(/WARN\s+\.env\.local was found but contains no KEY=value lines/);
});

test("a variable already set in the shell is reported as overriding the file", async () => {
  const { out } = doctor({ envFile: ENV_BASE, env: { DISCORD_USER_ID: "" } });
  expect(out).toMatch(/WARN\s+DISCORD_USER_ID is already set in this shell's environment, and it overrides \.env\.local/);
  expect(out).toContain("it is set to an empty value");
  expect(out).not.toContain(TEST_DISCORD_ID);
});

test("NODE_ENV=test, which makes Next.js skip .env.local, is called out", async () => {
  const { out } = doctor({ envFile: ENV_BASE, env: { NODE_ENV: "test" } });
  expect(out).toMatch(/WARN\s+NODE_ENV is 'test' in this shell/);
});

test("the blank template, which is what copying .env.example over a filled-in file leaves, is recognised", async () => {
  const template = ["DISCORD_USER_ID=", "LISTENBRAINZ_USERNAME=", "LISTENBRAINZ_TOKEN=", "GITHUB_TOKEN=", "SHOW_DIAGNOSTICS="].join("\n");
  const { out, status } = doctor({ envFile: template });
  expect(out).toMatch(/FAIL\s+\.env\.local lists .* but every value is empty: it looks like the blank template/);
  expect(out).toContain("restore your values from the original download or a backup");
  expect(status).toBe(1);
});

test("a partly filled file is not mistaken for the template", async () => {
  const { out } = doctor({ envFile: [ENV_BASE, "LISTENBRAINZ_USERNAME=", "LISTENBRAINZ_TOKEN=", "GITHUB_TOKEN="].join("\n") });
  expect(out).not.toContain("looks like the blank template");
});

test("a stale .env.development.local that outranks .env.local in 'npm run dev' is reported", async () => {
  const { out } = doctor({ envFile: ENV_BASE, files: { ".env.development.local": "DISCORD_USER_ID=\n" } });
  expect(out).toMatch(/WARN\s+\.env\.development\.local also sets DISCORD_USER_ID \(empty\); in 'npm run dev' it outranks \.env\.local/);
  expect(out).toContain("fix: delete .env.development.local");
});

test("settings that come from the shell, as in Docker, are not reported as a missing file", async () => {
  const { out, status } = doctor({ env: { DISCORD_USER_ID: TEST_DISCORD_ID, LISTENBRAINZ_USERNAME: "fixture-user" } });
  expect(out).toContain("no environment file here: the settings come from this shell's environment");
  expect(out).not.toMatch(/FAIL\s+no \.env\.local/);
  expect(out).toMatch(/PASS\s+50 recent listens found for "fixture-user"/);
  expect(status).toBe(0);
});

test("with no file and no settings anywhere it is still a failure", async () => {
  const { out, status } = doctor();
  expect(out).toMatch(/FAIL\s+no \.env\.local \(or \.env\) file in this folder/);
  expect(status).toBe(1);
});

test("an identity.ts alone is enough, as on a host that never receives .env.local", async () => {
  const identityFile = `export const identity = {\n  discordUserId: "${TEST_DISCORD_ID}" as string | null,\n  listenbrainzUsername: "fixture-user" as string | null,\n  showDiagnostics: false,\n};\n`;
  const { out, status } = doctor({ identityFile });
  expect(out).toContain("no environment file here");
  expect(status).toBe(0);
});

test("names are read the way the site reads them: 'a or b', @name and a pasted profile address", async () => {
  for (const names of ["not-a-user or fixture-user", "@not-a-user; fixture-user", "https://listenbrainz.org/user/fixture-user/"]) {
    const { out } = doctor({ envFile: [ENV_BASE, `LISTENBRAINZ_USERNAME=${names}`].join("\n") });
    expect(out, names).toMatch(/PASS\s+50 recent listens found for "fixture-user"/);
  }
});

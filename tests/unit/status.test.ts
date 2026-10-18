import { describe, expect, it } from "vitest";
import type { PresenceSnapshot } from "@/data/discord/snapshot";
import type { ContributionCalendar, ListeningData, Loaded, Repository } from "@/data/types";
import { formatStatus, type StatusInput } from "@/lib/server/status";

const ok = <T>(data: T, stale = false): Loaded<T> => ({ status: "ok", data, fetchedAt: 1, stale });
const SECRET = "ghp_this_must_never_be_printed_0123456789";

const calendar: ContributionCalendar = { total: 31, weeks: [], from: "2025-10-19", to: "2026-10-18" };
const listening: ListeningData = {
  account: "nothikemu",
  nowPlaying: null,
  spotifyOnly: false,
  omitted: 0,
  listens: [{ id: "1", title: "T", artist: "A", album: null, artworkUrl: null, spotifyUrl: null, listenedAt: Date.parse("2026-10-18T12:34:00Z") }],
};
const presence = { tracked: true, presence: { status: "online" } } as unknown as PresenceSnapshot;

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    visibleBecause: "SHOW_DIAGNOSTICS",
    node: "v22.0.0",
    mode: "production",
    build: "abc123 (made 2026-10-18 12:00 UTC)",
    folder: "/srv/dashboard",
    envFiles: [{ name: ".env.local", bytes: 210, utf16: false, defines: ["DISCORD_USER_ID", "GITHUB_TOKEN", "SHOW_DIAGNOSTICS"] }],
    discordUserId: "100000000000000001",
    listenbrainzNames: ["nothikemu", "hikemu"],
    settings: {
      DISCORD_USER_ID: "environment",
      LISTENBRAINZ_USERNAME: "src/config/identity.ts",
      LISTENBRAINZ_TOKEN: "not set",
      GITHUB_TOKEN: "environment",
      SHOW_DIAGNOSTICS: "environment",
    },
    discord: ok(presence),
    listening: ok(listening),
    projects: ok([{ id: 1 }, { id: 2 }] as unknown as Repository[]),
    activity: ok(calendar),
    ...overrides,
  };
}

describe("formatStatus", () => {
  it("reports a healthy server plainly, with no to-do list", () => {
    const text = formatStatus(input());
    expect(text).toMatch(/PASS\s+discord \(lanyard\)\s+tracked, status online/);
    expect(text).toMatch(/PASS\s+listenbrainz\s+account "nothikemu": 1 listens, newest 2026-10-18 12:34 UTC/);
    expect(text).toMatch(/PASS\s+github projects\s+2 public repositories/);
    expect(text).toMatch(/PASS\s+github contributions\s+31 contributions/);
    expect(text).toContain("everything this server can check is working");
    expect(text).not.toContain("what to do");
  });

  it("says why the page is visible, and warns that it is readable while on", () => {
    expect(formatStatus(input({ visibleBecause: "SHOW_DIAGNOSTICS" }))).toContain("shown because SHOW_DIAGNOSTICS is on");
    expect(formatStatus(input({ visibleBecause: "development build" }))).toContain("shown because this is a development build");
    const warning = formatStatus(input());
    expect(warning).toContain("Anyone who knows this address can read this page while it is on");
  });

  it("says where each setting came from and never prints a credential", () => {
    const text = formatStatus(input());
    expect(text).toMatch(/DISCORD_USER_ID\s+set, from environment/);
    expect(text).toMatch(/LISTENBRAINZ_USERNAME\s+set, from src\/config\/identity\.ts/);
    expect(text).toMatch(/LISTENBRAINZ_TOKEN\s+not set/);
    expect(text).toMatch(/GITHUB_TOKEN\s+set, from environment\s+\(credential, hidden\)/);
    expect(text).not.toContain(SECRET);
  });

  it("explains a configuration that never reached the server, for local and hosted setups", () => {
    const text = formatStatus(
      input({
        settings: { DISCORD_USER_ID: "not set", LISTENBRAINZ_USERNAME: "not set", LISTENBRAINZ_TOKEN: "not set", GITHUB_TOKEN: "not set", SHOW_DIAGNOSTICS: "src/config/identity.ts" },
        discord: { status: "missing-config", missing: ["DISCORD_USER_ID"] },
        listening: { status: "missing-config", missing: ["LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN"] },
      }),
    );
    expect(text).toMatch(/FAIL\s+discord \(lanyard\)\s+DISCORD_USER_ID did not reach this server/);
    expect(text).toMatch(/FAIL\s+listenbrainz\s+neither LISTENBRAINZ_USERNAME nor LISTENBRAINZ_TOKEN reached this server/);
    expect(text).toContain("what to do");
    expect(text).toContain("DISCORD_USER_ID=... must be in .env.local next to package.json");
    expect(text).toContain("on Vercel, Netlify or similar: .env.local is never uploaded");
    expect(text).toContain("or set discordUserId in src/config/identity.ts");
    expect(text).toContain("or set listenbrainzUsername in src/config/identity.ts");
    // this page is /status: it never tells the reader to open it
    expect(text).not.toContain("Open /status");
  });

  it("gives the specific next step for each ListenBrainz and Lanyard failure", () => {
    const notFound = formatStatus(input({ listening: { status: "unavailable", reason: "not-found", detail: 'listenbrainz (no user named "a" or "b"): not-found (404)' } }));
    expect(notFound).toContain('no user named "a" or "b"');
    expect(notFound).toContain("listenbrainz.org/user/<name>");
    expect(notFound).toContain("list guesses separated by commas");

    const rejected = formatStatus(input({ listening: { status: "unavailable", reason: "auth", detail: "listenbrainz-token: auth" } }));
    expect(rejected).toContain("was it reset?");
    expect(rejected).toContain("public listens need no token");

    const noToken = formatStatus(input({ activity: { status: "missing-config", missing: ["GITHUB_TOKEN"] } }));
    expect(noToken).toMatch(/FAIL\s+github contributions\s+GitHub's public contributions page could not be used and no GITHUB_TOKEN is set/);
    expect(noToken).toContain("read-only fine-grained token");

    const unreachable = formatStatus(input({ listening: { status: "unavailable", reason: "network" }, discord: { status: "unavailable", reason: "network", detail: "lanyard: network" } }));
    expect(unreachable).toContain("cannot reach api.listenbrainz.org");
    expect(unreachable).toContain("cannot reach api.lanyard.rest");

    const untracked = formatStatus(input({ discord: ok({ tracked: false, presence: null }) }));
    expect(untracked).toMatch(/FAIL\s+discord \(lanyard\)\s+Lanyard does not track this account/);
    expect(untracked).toContain("https://discord.gg/UrXF2cfJ7F");
  });

  it("marks stale data as stale instead of presenting it as current", () => {
    const text = formatStatus(input({ listening: ok(listening, true), projects: ok([] as Repository[], true) }));
    expect(text).toMatch(/listenbrainz\s+account "nothikemu".*\(stale\)/);
    expect(text).toMatch(/github projects\s+0 public repositories \(stale\)/);
  });
});

describe("formatStatus: what the server's folder and settings say", () => {
  it("shows the build, the folder and the public identifiers in use, so a wrong one can be spotted", () => {
    const text = formatStatus(input());
    expect(text).toMatch(/build\s+abc123 \(made 2026-10-18 12:00 UTC\)/);
    expect(text).toMatch(/folder\s+\/srv\/dashboard/);
    expect(text).toContain("Discord ID in use:  100000000000000001 (18 digits; it must be your own user ID)");
    expect(text).toContain("ListenBrainz names: nothikemu, hikemu (tried in this order)");
  });

  it("lists the environment files and which settings each assigns, never a value", () => {
    const text = formatStatus(input());
    expect(text).toMatch(/\.env\.local\s+210 bytes; defines DISCORD_USER_ID, GITHUB_TOKEN, SHOW_DIAGNOSTICS/);
  });

  it("calls out a UTF-16 file, and an empty folder on a hosted platform", () => {
    const utf16 = formatStatus(input({ envFiles: [{ name: ".env.local", bytes: 400, utf16: true, defines: [] }] }));
    expect(utf16).toContain("SAVED AS UTF-16");
    expect(utf16).toContain("re-save as UTF-8");
    const hosted = formatStatus(input({ envFiles: [] }));
    expect(hosted).toContain("none found (normal on hosted platforms");
  });

  it("explains a setting the file assigns but the server never received", () => {
    const text = formatStatus(
      input({
        settings: { DISCORD_USER_ID: "not set", LISTENBRAINZ_USERNAME: "not set", LISTENBRAINZ_TOKEN: "not set", GITHUB_TOKEN: "environment", SHOW_DIAGNOSTICS: "environment" },
        discord: { status: "missing-config", missing: ["DISCORD_USER_ID"] },
      }),
    );
    expect(text).toContain("an environment file defines DISCORD_USER_ID, but this server has no value for it");
    expect(text).toContain("NODE_ENV=test skips .env.local");
    expect(text).not.toContain("defines GITHUB_TOKEN, but");
  });
});

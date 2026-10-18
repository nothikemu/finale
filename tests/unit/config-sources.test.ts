import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identity } from "@/config/identity";
import { configSource, serverEnv } from "@/lib/server/env";

const KEYS = ["DISCORD_USER_ID", "LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN", "GITHUB_TOKEN", "SHOW_DIAGNOSTICS"] as const;
const saved: Record<string, string | undefined> = {};

function reset() {
  for (const key of KEYS) delete process.env[key];
  identity.discordUserId = null;
  identity.listenbrainzUsername = null;
  identity.showDiagnostics = false;
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  reset();
});
afterEach(() => {
  reset();
  for (const key of KEYS) if (saved[key] !== undefined) process.env[key] = saved[key];
});

describe("where configuration comes from", () => {
  it("is empty when nothing is set anywhere", () => {
    expect(serverEnv.discordUserId).toBeUndefined();
    expect(serverEnv.listenbrainzUsername).toBeUndefined();
    expect(serverEnv.showDiagnostics).toBe(false);
    for (const key of KEYS) expect(configSource(key)).toBe("not set");
  });

  it("falls back to src/config/identity.ts for public identifiers when the environment has none", () => {
    identity.discordUserId = " 100000000000000001 ";
    identity.listenbrainzUsername = "someone";
    expect(serverEnv.discordUserId).toBe("100000000000000001");
    expect(serverEnv.listenbrainzUsername).toBe("someone");
    expect(configSource("DISCORD_USER_ID")).toBe("src/config/identity.ts");
    expect(configSource("LISTENBRAINZ_USERNAME")).toBe("src/config/identity.ts");
  });

  it("lets an environment variable win over the file", () => {
    identity.discordUserId = "100000000000000001";
    process.env.DISCORD_USER_ID = "200000000000000002";
    expect(serverEnv.discordUserId).toBe("200000000000000002");
    expect(configSource("DISCORD_USER_ID")).toBe("environment");
  });

  it("treats blank and placeholder values as unset, in both places", () => {
    process.env.DISCORD_USER_ID = "   ";
    identity.discordUserId = "replace-with-your-id";
    expect(serverEnv.discordUserId).toBeUndefined();
    expect(configSource("DISCORD_USER_ID")).toBe("not set");
    process.env.LISTENBRAINZ_USERNAME = "your-username-here";
    expect(serverEnv.listenbrainzUsername).toBeUndefined();
  });

  it("reads credentials from the environment only", () => {
    expect(Object.keys(identity).sort()).toEqual(["discordUserId", "listenbrainzUsername", "showDiagnostics"]);
    process.env.GITHUB_TOKEN = "env-token";
    process.env.LISTENBRAINZ_TOKEN = "env-lb-token";
    expect(serverEnv.githubToken).toBe("env-token");
    expect(configSource("GITHUB_TOKEN")).toBe("environment");
    expect(configSource("LISTENBRAINZ_TOKEN")).toBe("environment");
  });

  it("cleans copy-paste artefacts: invisible characters, quotes and surrounding spaces", () => {
    process.env.DISCORD_USER_ID = "\u200B\u201C100000000000000001\u201D\uFEFF ";
    expect(serverEnv.discordUserId).toBe("100000000000000001");
    process.env.LISTENBRAINZ_USERNAME = `  "nothikemu"\u200E `;
    expect(serverEnv.listenbrainzUsername).toBe("nothikemu");
    identity.discordUserId = "'200000000000000002'";
    delete process.env.DISCORD_USER_ID;
    expect(serverEnv.discordUserId).toBe("200000000000000002");
    // quotes inside a value are the owner's business
    process.env.LISTENBRAINZ_USERNAME = "it's-me";
    expect(serverEnv.listenbrainzUsername).toBe("it's-me");
  });

  it("lets SHOW_DIAGNOSTICS=0 switch hints off even when identity.ts switches them on", () => {
    identity.showDiagnostics = true;
    expect(serverEnv.diagnosticsSetting).toBe(true);
    process.env.SHOW_DIAGNOSTICS = "0";
    expect(serverEnv.diagnosticsSetting).toBe(false);
    expect(serverEnv.showDiagnostics).toBe(false);
    expect(configSource("SHOW_DIAGNOSTICS")).toBe("environment");
    delete process.env.SHOW_DIAGNOSTICS;
    identity.showDiagnostics = false;
    expect(serverEnv.diagnosticsSetting).toBeUndefined();
    process.env.SHOW_DIAGNOSTICS = "maybe";
    expect(serverEnv.diagnosticsSetting).toBeUndefined();
  });

  it("switches diagnostics on from either source", () => {
    identity.showDiagnostics = true;
    expect(serverEnv.showDiagnostics).toBe(true);
    expect(configSource("SHOW_DIAGNOSTICS")).toBe("src/config/identity.ts");
    identity.showDiagnostics = false;
    for (const on of ["1", "true", "YES", "on"]) {
      process.env.SHOW_DIAGNOSTICS = on;
      expect(serverEnv.showDiagnostics).toBe(true);
      expect(configSource("SHOW_DIAGNOSTICS")).toBe("environment");
    }
    for (const off of ["0", "false", "", "maybe"]) {
      process.env.SHOW_DIAGNOSTICS = off;
      expect(serverEnv.showDiagnostics).toBe(false);
    }
  });
});

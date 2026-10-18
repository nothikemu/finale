import "server-only";

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PresenceSnapshot } from "@/data/discord/snapshot";
import { loadPresence } from "@/data/discord/snapshot";
import { loadContributions } from "@/data/github/contributions";
import { loadProjects } from "@/data/github/projects";
import { loadListening } from "@/data/listenbrainz";
import type { ContributionCalendar, ListeningData, Loaded, Repository } from "@/data/types";
import { describeFailure } from "@/lib/failure";
import type { DiagnosticsReason } from "./diagnostics";
import { configSource, serverEnv, type ConfigSource } from "./env";
import { splitUsernames } from "@/data/listenbrainz";

/**
 * A plain-text report of what THIS running server sees: which settings reached it
 * (and from where, never their values), and one live check per integration made
 * from the same process. It is the one thing to open, or copy back to whoever is
 * helping, when a panel does not work. Credentials never appear in it.
 */

const INVITE = "https://discord.gg/UrXF2cfJ7F";

const SETTINGS = ["DISCORD_USER_ID", "LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN", "GITHUB_TOKEN", "SHOW_DIAGNOSTICS"] as const;
type Setting = (typeof SETTINGS)[number];

/** Public identifiers may be shown as set/not set; credentials are only ever "set" or "not set". */
const NOTES: Record<Setting, string> = {
  DISCORD_USER_ID: "public ID",
  LISTENBRAINZ_USERNAME: "public name, or comma-separated candidates",
  LISTENBRAINZ_TOKEN: "credential, hidden",
  GITHUB_TOKEN: "credential, hidden",
  SHOW_DIAGNOSTICS: "owner switch",
};

const WHY_VISIBLE: Record<DiagnosticsReason, string> = {
  SHOW_DIAGNOSTICS: "SHOW_DIAGNOSTICS is on",
  "development build": "this is a development build",
  "local viewer": "you are viewing it from the machine running the server (visitors get a 404)",
};

/** What this server's folder holds in the way of environment files. Names and sizes only, never contents. */
export interface EnvFileInfo {
  name: string;
  bytes: number;
  utf16: boolean;
  /** Which of the five settings the file assigns (by key name). */
  defines: Setting[];
}

export interface StatusInput {
  visibleBecause: DiagnosticsReason;
  node: string;
  mode: string;
  /** This build's id and when it was made, so an edit that needs a rebuild is visible as not applied. */
  build: string;
  folder: string;
  envFiles: EnvFileInfo[];
  /** Public identifiers only (never credentials): shown so a wrong ID or spelling can be spotted. */
  discordUserId: string | null;
  listenbrainzNames: string[];
  settings: Record<Setting, ConfigSource>;
  discord: Loaded<PresenceSnapshot>;
  listening: Loaded<ListeningData>;
  projects: Loaded<Repository[]>;
  activity: Loaded<ContributionCalendar>;
}

interface Line {
  ok: boolean;
  name: string;
  text: string;
  /** What the owner should do next, when this check failed: one step per entry. */
  fix?: string[];
}

const pad = (text: string, width: number) => text.padEnd(width, " ");

/** This page IS /status, so unlike the panels it never sends the reader back here. */
function failureText(result: Loaded<unknown>): string {
  if (result.status === "missing-config") return `${result.missing.join(" or ")} not set`;
  return describeFailure(result) ?? "unknown failure";
}

function discordLine(result: Loaded<PresenceSnapshot>): Line {
  const name = "discord (lanyard)";
  if (result.status === "ok") {
    if (!result.data.tracked) {
      return { ok: false, name, text: "Lanyard does not track this account", fix: [`join ${INVITE} (the invite in Lanyard's README) with this exact Discord account, then wait a minute`] };
    }
    const status = result.data.presence?.status ?? "unknown";
    return { ok: true, name, text: `tracked, status ${status}${result.stale ? " (stale)" : ""}` };
  }
  if (result.status === "missing-config") {
    return { ok: false, name, text: "DISCORD_USER_ID did not reach this server", fix: missingFix("DISCORD_USER_ID", "discordUserId") };
  }
  const fix = result.reason === "network" ? ["this server cannot reach api.lanyard.rest (firewall, proxy or no internet); visitors' browsers can still try it directly"] : undefined;
  return { ok: false, name, text: failureText(result), fix };
}

function listeningLine(result: Loaded<ListeningData>): Line {
  const name = "listenbrainz";
  if (result.status === "ok") {
    const newest = result.data.listens[0];
    const when = newest ? `, newest ${new Date(newest.listenedAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
    const now = result.data.nowPlaying ? ", playing now" : "";
    return { ok: true, name, text: `account "${result.data.account}": ${result.data.listens.length} listens${when}${now}${result.stale ? " (stale)" : ""}` };
  }
  if (result.status === "missing-config") {
    return { ok: false, name, text: "neither LISTENBRAINZ_USERNAME nor LISTENBRAINZ_TOKEN reached this server", fix: missingFix("LISTENBRAINZ_USERNAME", "listenbrainzUsername") };
  }
  let fix: string[] | undefined;
  if (result.reason === "not-found") {
    fix = ["use the name in the address of your ListenBrainz profile (listenbrainz.org/user/<name>)", "unsure of the spelling? list guesses separated by commas, and the first one ListenBrainz knows is used"];
  } else if (result.reason === "auth") {
    fix = ["the token was rejected (was it reset?)", "set the username instead: public listens need no token. A fresh token also works"];
  } else if (result.reason === "network") {
    fix = ["this server cannot reach api.listenbrainz.org (firewall, proxy or no internet)"];
  }
  return { ok: false, name, text: failureText(result), fix };
}

function projectsLine(result: Loaded<Repository[]>): Line {
  const name = "github projects";
  if (result.status === "ok") return { ok: true, name, text: `${result.data.length} public repositories${result.stale ? " (stale)" : ""}` };
  return { ok: false, name, text: failureText(result) };
}

function activityLine(result: Loaded<ContributionCalendar>): Line {
  const name = "github contributions";
  if (result.status === "ok") return { ok: true, name, text: `${result.data.total} contributions, ${result.data.from} to ${result.data.to}${result.stale ? " (stale)" : ""}` };
  if (result.status === "missing-config") {
    return {
      ok: false,
      name,
      text: "GitHub's public contributions page could not be used and no GITHUB_TOKEN is set",
      fix: ["check that this server can reach github.com", "or set GITHUB_TOKEN to a read-only fine-grained token (see README)"],
    };
  }
  return { ok: false, name, text: failureText(result) };
}

function missingFix(envName: string, identityKey: string): string[] {
  return [
    `running locally: ${envName}=... must be in .env.local next to package.json, and the server restarted afterwards`,
    `on Vercel, Netlify or similar: .env.local is never uploaded, so add ${envName} in the host's Environment Variables and redeploy`,
    `or set ${identityKey} in src/config/identity.ts, which travels with the project`,
  ];
}

export function formatStatus(input: StatusInput): string {
  const checks = [discordLine(input.discord), listeningLine(input.listening), projectsLine(input.projects), activityLine(input.activity)];
  const out: string[] = [];
  out.push("nothikemu dashboard: status");
  out.push(`owner diagnostics, shown because ${WHY_VISIBLE[input.visibleBecause]}.`);
  out.push("Set SHOW_DIAGNOSTICS=0 to hide it everywhere once everything works. Credentials never appear here.");
  out.push("");
  out.push("runtime");
  out.push(`  node      ${input.node}`);
  out.push(`  mode      ${input.mode}`);
  out.push(`  build     ${input.build}`);
  out.push(`  folder    ${input.folder}`);
  out.push("");
  out.push("settings this server received");
  for (const key of SETTINGS) {
    const source = input.settings[key];
    out.push(`  ${pad(key, 22)} ${pad(source === "not set" ? "not set" : `set, from ${source}`, 34)} (${NOTES[key]})`);
  }
  if (input.discordUserId) out.push(`  Discord ID in use:  ${input.discordUserId} (${input.discordUserId.length} digits; it must be your own user ID)`);
  if (input.listenbrainzNames.length > 0) out.push(`  ListenBrainz names: ${input.listenbrainzNames.join(", ")} (tried in this order)`);
  out.push("");
  out.push("environment files in that folder");
  if (input.envFiles.length === 0) out.push("  none found (normal on hosted platforms, where settings come from the host)");
  for (const file of input.envFiles) {
    out.push(`  ${pad(file.name, 22)} ${file.bytes} bytes${file.utf16 ? ", SAVED AS UTF-16: Next.js ignores every line in it, re-save as UTF-8" : ""}${file.defines.length > 0 ? `; defines ${file.defines.join(", ")}` : file.utf16 ? "" : "; defines none of the five settings"}`);
  }
  for (const key of SETTINGS) {
    const defined = input.envFiles.some((file) => file.defines.includes(key));
    if (defined && input.settings[key] === "not set") {
      out.push(`  note: an environment file defines ${key}, but this server has no value for it: the value is blank or a placeholder, or the file was not loaded (NODE_ENV=test skips .env.local; a UTF-16 file is unreadable)`);
    }
  }
  out.push("");
  out.push("checks made by this server just now");
  for (const line of checks) out.push(`  ${line.ok ? "PASS" : "FAIL"}  ${pad(line.name, 22)} ${line.text}`);
  const failed = checks.filter((line) => !line.ok);
  out.push("");
  if (failed.length === 0) {
    out.push("everything this server can check is working.");
    out.push("Discord's live updates also need the visitor's browser to reach wss://api.lanyard.rest/socket; without it the panel still shows data, labelled stale.");
  } else {
    out.push("what to do");
    for (const line of failed) {
      out.push(`  ${line.name}`);
      for (const step of line.fix ?? ["see the README troubleshooting table"]) out.push(`    - ${step}`);
    }
  }
  out.push("");
  return out.join("\n");
}

const ENV_FILES = [".env.local", ".env", ".env.production", ".env.production.local"];

/** Reads which environment files sit beside the server and which settings they assign. Never returns a value. */
export function describeEnvFiles(folder: string): EnvFileInfo[] {
  const found: EnvFileInfo[] = [];
  for (const name of ENV_FILES) {
    try {
      // Looking at the server's own folder at run time is the point; keep the bundler from tracing it into the build.
      const bytes = readFileSync(join(/* turbopackIgnore: true */ folder, name));
      const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0);
      const text = utf16 ? "" : bytes.toString("utf8");
      const defines = SETTINGS.filter((key) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "m").test(text));
      found.push({ name, bytes: bytes.length, utf16, defines });
    } catch {
      // not there, or not readable: absent from the list
    }
  }
  return found;
}

function describeBuild(folder: string): string {
  try {
    const file = join(folder, ".next", "BUILD_ID");
    const id = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
    const built = statSync(/* turbopackIgnore: true */ file).mtime.toISOString().slice(0, 16).replace("T", " ");
    return `${id} (made ${built} UTC)`;
  } catch {
    return "unknown (development, or not a standard build folder)";
  }
}

export async function buildStatusReport(visibleBecause: DiagnosticsReason): Promise<string> {
  const [discord, listening, projects, activity] = await Promise.all([loadPresence(), loadListening(), loadProjects(), loadContributions()]);
  const settings = Object.fromEntries(SETTINGS.map((key) => [key, configSource(key)])) as Record<Setting, ConfigSource>;
  const folder = process.cwd();
  return formatStatus({
    visibleBecause,
    build: describeBuild(folder),
    folder,
    envFiles: describeEnvFiles(folder),
    discordUserId: serverEnv.discordUserId ?? null,
    listenbrainzNames: splitUsernames(serverEnv.listenbrainzUsername).valid,
    node: process.version,
    mode: process.env.NODE_ENV ?? "unknown",
    settings,
    discord,
    listening,
    projects,
    activity,
  });
}

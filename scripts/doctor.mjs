#!/usr/bin/env node
/**
 * `npm run doctor`: checks the dashboard's configuration and every live
 * integration from THIS machine, and says exactly what is wrong and how to fix
 * it. Run it wherever the site runs (your laptop, the server).
 *
 * It only reads. It never prints a credential: environment variables are
 * reported as "set" / "not set" plus whether their format looks right.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

const USERNAME = "nothikemu"; // keep in sync with site.githubUsername in src/config/site.ts
const TIMEOUT_MS = 12_000;
const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const ok = (text) => console.log(`  ${paint(32, "PASS")}  ${text}`);
const bad = (text) => console.log(`  ${paint(31, "FAIL")}  ${text}`);
const warn = (text) => console.log(`  ${paint(33, "WARN")}  ${text}`);
const info = (text) => console.log(`        ${paint(2, text)}`);
const heading = (text) => console.log(`\n${paint(1, text)}`);

const problems = [];
const fail = (text, fix) => {
  bad(text);
  if (fix) info(`fix: ${fix}`);
  problems.push(text);
};

// ---- environment -----------------------------------------------------------

heading("1. Environment");
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number);
if (nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 9)) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old (Next.js 16 needs 20.9 or newer)`, "install a current Node LTS from https://nodejs.org");

const SETTINGS = ["DISCORD_USER_ID", "LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN", "GITHUB_TOKEN", "SHOW_DIAGNOSTICS"];
// What the shell already holds wins over every env file, so remember it before the files are read.
const shellHad = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));
const loaded = nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const envFiles = [".env.local", ".env", ".env.production", ".env.production.local"].filter((f) => existsSync(join(process.cwd(), f)));
if (envFiles.length) ok(`environment files found: ${envFiles.join(", ")}`);
let pendingNoFile = null;
if (!envFiles.length) {
  let lookalikes = [];
  try {
    lookalikes = readdirSync(process.cwd()).filter((name) => /^\.?env([._ -].*)?$/i.test(name) && !/^\.env\.example$/i.test(name));
  } catch {
    // unreadable folder: the generic message below still applies
  }
  // Whether this is a problem depends on where the settings come from, which is known once they are read below.
  pendingNoFile = {
    lookalike: lookalikes.length > 0,
    text: lookalikes.length ? `no .env.local in this folder, but these look like it: ${lookalikes.join(", ")}` : "no .env.local (or .env) file in this folder",
    fix: lookalikes.length
      ? "rename it to exactly .env.local (Windows Explorer hides extensions: '.env.local.txt' shows as '.env.local')"
      : "create .env.local from .env.example (only if you have none), or set the variables in your host's settings; dotfiles are hidden in Finder/Explorer, so check from a terminal with: ls -a",
  };
}
info(`looked in ${process.cwd()}`);

for (const entry of loaded.loadedEnvFiles ?? []) {
  const name = entry.path;
  const bytes = (() => {
    try {
      return readFileSync(join(process.cwd(), name));
    } catch {
      return Buffer.alloc(0);
    }
  })();
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0);
  if (utf16) fail(`${name} is saved as UTF-16, which Next.js cannot read: every variable in it is ignored`, "re-save it as UTF-8 (Notepad: File > Save As > Encoding: UTF-8; PowerShell's '>' redirection writes UTF-16)");
  else if (bytes.length === 0) warn(`${name} is empty`);
  else if (Object.keys(entry.env ?? {}).length === 0) warn(`${name} was found but contains no KEY=value lines that could be read`);
}
/** The value an env file assigns to `name`, read from its raw text (the loader rewrites its parsed copy). */
function rawFileValue(contents, name) {
  // Spaces and tabs only around "=": \\s would also swallow the newline and read the next line as this value.
  const match = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(.*)$`, "m").exec(contents ?? "");
  if (!match) return undefined;
  let value = match[1].trim();
  const quote = /^(["'])(.*?)\1/.exec(value);
  value = quote ? quote[2] : value.replace(/\s+#.*$/, "");
  return value.trim();
}
for (const name of SETTINGS) {
  const fromShell = shellHad[name];
  if (fromShell === undefined) continue;
  for (const entry of loaded.loadedEnvFiles ?? []) {
    const fileValue = rawFileValue(entry.contents, name);
    if (fileValue === undefined || fileValue === fromShell) continue;
    warn(`${name} is already set in this shell's environment, and it overrides ${entry.path}`);
    info(fromShell === "" ? `it is set to an empty value; remove it with: unset ${name} (PowerShell: Remove-Item Env:${name})` : "the file's value is ignored; remove the shell variable or use it intentionally");
    break;
  }
}
// A file whose settings are all present but empty is the blank template: the usual result of copying
// .env.example over a file that had values in it.
for (const entry of loaded.loadedEnvFiles ?? []) {
  const assigned = SETTINGS.filter((name) => rawFileValue(entry.contents, name) !== undefined);
  if (assigned.length >= 3 && assigned.every((name) => rawFileValue(entry.contents, name) === "")) {
    fail(`${entry.path} lists ${assigned.join(", ")} but every value is empty: it looks like the blank template`, "if you copied .env.example over an existing .env.local, restore your values from the original download or a backup");
  }
}

// `npm run dev` reads different files from `npm start`; a stale or blank .env.development(.local) can outrank .env.local there.
const devFiles = [".env.development.local", ".env.development"].filter((f) => existsSync(join(process.cwd(), f)));
for (const file of devFiles) {
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), file), "utf8");
  } catch {
    continue;
  }
  const local = (loaded.loadedEnvFiles ?? []).find((entry) => entry.path === ".env.local");
  for (const name of SETTINGS) {
    const there = rawFileValue(text, name);
    const here = rawFileValue(local?.contents, name);
    if (there !== undefined && here !== undefined && there !== here) {
      warn(`${file} also sets ${name}${there === "" ? " (empty)" : ""}; in 'npm run dev' it outranks .env.local, which is what this check read`);
      info(`fix: delete ${file}, or remove ${name} from it`);
    }
  }
}
if (process.env.NODE_ENV === "test") {
  warn("NODE_ENV is 'test' in this shell: Next.js skips .env.local in that mode");
  info("fix: unset NODE_ENV (or set it to production)");
}

const env = (name) => (process.env[name] ?? "").trim();
const placeholder = /^(replace[_-]?with|your[_-]|changeme|todo$|xxx+$)/i;
const has = (name) => env(name) !== "" && !placeholder.test(env(name));

/** Public identifiers may also live in src/config/identity.ts (for hosts that never receive .env.local); the environment wins. */
function identityValue(key) {
  try {
    const text = readFileSync(join(process.cwd(), "src/config/identity.ts"), "utf8");
    const value = new RegExp(`\\b${key}:\\s*(?:null\\s+as\\s+string\\s*\\|\\s*null|"([^"]*)")`).exec(text)?.[1]?.trim() ?? "";
    return value && !placeholder.test(value) ? value : "";
  } catch {
    return "";
  }
}

const discordFromEnv = has("DISCORD_USER_ID");
const discordId = discordFromEnv ? env("DISCORD_USER_ID") : identityValue("discordUserId");
const lbToken = env("LISTENBRAINZ_TOKEN");
const lbUserFromEnv = has("LISTENBRAINZ_USERNAME");
const lbUser = lbUserFromEnv ? env("LISTENBRAINZ_USERNAME") : identityValue("listenbrainzUsername");
const ghToken = env("GITHUB_TOKEN");

if (pendingNoFile) {
  const fromElsewhere = SETTINGS.some((name) => has(name)) || discordId !== "" || lbUser !== "";
  if (!pendingNoFile.lookalike && fromElsewhere) info("no environment file here: the settings come from this shell's environment or src/config/identity.ts (normal for Docker and hosts)");
  else fail(pendingNoFile.text, pendingNoFile.fix);
}

if (!discordId) {
  fail("DISCORD_USER_ID is not set: the Discord panel will say 'presence not configured'", "set DISCORD_USER_ID=<your numeric Discord ID> (or discordUserId in src/config/identity.ts)");
} else if (/^\d{15,25}$/.test(discordId)) {
  ok(discordFromEnv ? "DISCORD_USER_ID is set and looks like a Discord ID" : "discordUserId in src/config/identity.ts is set and looks like a Discord ID");
} else {
  fail("DISCORD_USER_ID is set but is not a numeric Discord ID", "copy your User ID from Discord (Settings > Advanced > Developer Mode, then right-click your profile > Copy User ID)");
}

if (lbUser) ok(lbUserFromEnv ? "LISTENBRAINZ_USERNAME is set (no token is needed to read public listens)" : "listenbrainzUsername in src/config/identity.ts is set (no token is needed to read public listens)");
if (has("LISTENBRAINZ_TOKEN")) {
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(lbToken)) ok("LISTENBRAINZ_TOKEN is set and has the expected format");
  else warn("LISTENBRAINZ_TOKEN is set but is not in the usual UUID format; it may have been copied incorrectly");
}
if (!lbUser && !has("LISTENBRAINZ_TOKEN")) {
  fail("neither LISTENBRAINZ_TOKEN nor LISTENBRAINZ_USERNAME is set: the listening panel will say 'listening not configured'", "set LISTENBRAINZ_USERNAME=<your ListenBrainz username> (simplest, nothing secret), or listenbrainzUsername in src/config/identity.ts; a LISTENBRAINZ_TOKEN from https://listenbrainz.org/settings/ also works");
}

if (has("GITHUB_TOKEN")) {
  if (/^(github_pat_[A-Za-z0-9_]{60,}|gh[pousr]_[A-Za-z0-9]{30,})$/.test(ghToken)) ok("GITHUB_TOKEN is set and has the expected format");
  else warn("GITHUB_TOKEN is set but does not look like a GitHub token; it may be truncated");
} else warn("GITHUB_TOKEN is not set: repositories and the public calendar still work, but with lower rate limits");

const proxy = env("HTTPS_PROXY") || env("https_proxy") || env("HTTP_PROXY") || env("http_proxy");
if (proxy && env("NODE_USE_ENV_PROXY") !== "1") {
  warn("a proxy is configured in this shell, but Node's built-in fetch ignores HTTP(S)_PROXY by default");
  info("if every check below fails with a network error, run with NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24+), or allow direct internet access");
}

// ---- helpers -----------------------------------------------------------------

/** One request with a timeout. Never throws: returns { error } or { status, headers, text, json }. */
async function request(url, { headers = {}, method = "GET", body } = {}) {
  try {
    const response = await fetch(url, { method, body, headers: { "user-agent": "nothikemu-dashboard-doctor", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, text, json };
  } catch (error) {
    return { error: classify(error) };
  }
}

function classify(error) {
  const code = error?.cause?.code ?? error?.code;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return `timed out after ${TIMEOUT_MS / 1000}s`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed (no internet, or the host is blocked)";
  if (code === "ECONNREFUSED") return "connection refused (blocked by a firewall or proxy)";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection was reset (a firewall or proxy may be interfering)";
  if (typeof code === "string" && /CERT|SSL|TLS|SELF_SIGNED/.test(code)) return `TLS certificate problem (${code}); behind a corporate proxy, set NODE_EXTRA_CA_CERTS`;
  if (code === "UND_ERR_CONNECT_TIMEOUT") return "connection timed out";
  return `network error (${code ?? error?.message ?? "unknown"})`;
}

const NET_FIX = "check this machine's internet access, VPN, proxy and firewall";

/**
 * The same acceptance rules as src/data/github/public-calendar.ts, in plain JS:
 * at least 360 contiguous days, each with a 0-4 level, and a count for every
 * non-zero day. Returns the number of days, or 0 if the site could not use the page.
 */
function parsePublicDays(html) {
  const tooltips = new Map();
  for (const m of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const target = /\sfor="([^"]*)"/i.exec(` ${m[1]}`)?.[1];
    const text = /^\s*(No|\d[\d,]*)\s+contributions?\b/i.exec(m[2].replace(/\s+/g, " "));
    if (target && text) tooltips.set(target, text[1].toLowerCase() === "no" ? 0 : Number(text[1].replace(/,/g, "")));
  }
  const days = new Map();
  for (const m of html.matchAll(/<(?:td|rect)\b[^>]*>/gi)) {
    const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(m[0])?.[1] ?? null;
    const date = attr("data-date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) continue;
    const level = attr("data-level");
    if (level === null || !/^[0-4]$/.test(level)) return 0;
    const id = attr("id");
    const direct = attr("data-count");
    const count = direct !== null && /^\d+$/.test(direct) ? Number(direct) : id ? (tooltips.get(id) ?? null) : null;
    if (count === null && level !== "0") return 0;
    days.set(date, true);
  }
  const dates = [...days.keys()].sort();
  if (dates.length < 360) return 0;
  for (let i = 1; i < dates.length; i += 1) {
    if (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`) !== 86_400_000) return 0;
  }
  return dates.length;
}

// ---- Lanyard -------------------------------------------------------------------

heading("2. Discord presence (Lanyard)");
if (!/^\d{15,25}$/.test(discordId)) {
  warn("skipped: DISCORD_USER_ID is missing or invalid");
} else {
  const res = await request(`https://api.lanyard.rest/v1/users/${discordId}`);
  if (res.error) fail(`could not reach api.lanyard.rest: ${res.error}`, NET_FIX);
  else if (res.json?.success === true) {
    const data = res.json.data ?? {};
    ok(`Lanyard is tracking this account (status: ${data.discord_status ?? "unknown"})`);
    const keys = Object.keys(data.kv ?? {});
    info(`Lanyard KV keys present: ${keys.length ? keys.join(", ") : "none"}`);
    info(
      keys.includes("bio") || keys.includes("banner")
        ? "banner/bio will be read from KV keys 'banner' / 'bio'"
        : "no 'bio' or 'banner' KV key yet; set them with the Lanyard bot (see README) to show a bio and banner",
    );
    info("this machine can reach Lanyard, so the panel always has the dashboard's server as a second route");
    info("live updates also need the visitor's browser to reach wss://api.lanyard.rest/socket; without it the panel shows data that refreshes every 30 s and is labelled 'stale'");
  } else if (res.json?.error?.code === "user_not_monitored") {
    fail("Lanyard does not track this Discord account, so the panel will say 'presence not tracked'", "join https://discord.gg/UrXF2cfJ7F (the invite in Lanyard's README) with this exact Discord account, then wait a minute");
  } else fail(`Lanyard answered HTTP ${res.status}`, "try again shortly; if it persists, check https://status.lanyard.rest or Lanyard's Discord");
}

// ---- ListenBrainz ----------------------------------------------------------------

heading("3. Recently played (ListenBrainz)");
// Same rules as the site: a valid token says whose account this is; the username(s) are the fallback and may list several guesses.
// Same rules as splitUsernames() in src/data/listenbrainz.ts: separators, pasted profile addresses, @names, valid characters, at most five.
const lbEntry = (entry) => {
  const pasted = /^(?:https?:\/\/)?(?:www\.)?listenbrainz\.org\/user\/([^/?#]+)/i.exec(entry)?.[1];
  if (!pasted) return entry.replace(/^@+/, "");
  try {
    return decodeURIComponent(pasted);
  } catch {
    return entry;
  }
};
const lbNames = [...new Set(lbUser.split(/\s*(?:[,;|]|\s+or\s+)\s*/i).map((entry) => lbEntry(entry.trim())).filter((name) => /^[^\p{C}/\\?#%]{1,128}$/u.test(name)))].slice(0, 5);
const lbCandidates = [];
let tokenAccount = null; // the account a valid token belongs to: yours, whatever it holds
if (has("LISTENBRAINZ_TOKEN")) {
  const res = await request("https://api.listenbrainz.org/1/validate-token", { headers: { authorization: `Token ${lbToken}` } });
  if (res.error) (lbNames.length ? warn : (text) => fail(text, NET_FIX))(`could not reach api.listenbrainz.org to check the token: ${res.error}`);
  else if (res.json?.valid === true && res.json.user_name) {
    ok(`token is valid (ListenBrainz user: ${res.json.user_name})`);
    info(`your ListenBrainz username is "${res.json.user_name}". The site uses it, whatever LISTENBRAINZ_USERNAME says`);
    lbCandidates.push(res.json.user_name);
    tokenAccount = res.json.user_name;
  } else if (res.status === 429) fail("ListenBrainz is rate limiting this machine", "wait a few minutes and retry");
  else if (lbNames.length) {
    warn(`ListenBrainz rejected the token (HTTP ${res.status}${res.json?.message ? `: ${res.json.message}` : ""}); the site will use the username instead`);
    info("a token that was reset stops working; the username alone is enough for public listens");
  } else fail(`ListenBrainz rejected the token (HTTP ${res.status}${res.json?.message ? `: ${res.json.message}` : ""})`, "set LISTENBRAINZ_USERNAME (public listens need no token), or create a new token at https://listenbrainz.org/settings/ and update LISTENBRAINZ_TOKEN");
}
for (const name of lbNames) if (!lbCandidates.includes(name)) lbCandidates.push(name);
if (lbCandidates.length === 0) warn("skipped: no ListenBrainz username is set and no token could be used");

let lbName;
const unknownNames = [];
let emptyAccount = null;

function reportListens(candidate, res) {
  lbName = candidate;
  if (res.status !== 200 || !Array.isArray(res.json?.payload?.listens)) return fail(`listens request answered HTTP ${res.status}`, "try again shortly");
  const listens = res.json.payload.listens;
  const spotify = listens.filter((l) => {
    const i = l?.track_metadata?.additional_info ?? {};
    return String(i.music_service ?? "").toLowerCase() === "spotify.com" || String(i.music_service_name ?? "").toLowerCase() === "spotify" || String(i.spotify_id ?? "").includes("open.spotify.com/track/");
  }).length;
  if (listens.length === 0) {
    return fail(`ListenBrainz knows "${candidate}" but returned 0 listens, so the panel will say 'no recent listens'`, "connect Spotify under ListenBrainz > Settings > Connect services (or import your history), then play something");
  }
  ok(`${listens.length} recent listens found for "${candidate}" (${spotify} marked as coming from Spotify)`);
  const newest = Number(listens[0]?.listened_at);
  if (newest) info(`most recent listen: ${new Date(newest * 1000).toISOString()}`);
  if (spotify > 0 && spotify < listens.length) info("because some listens are marked as Spotify, only those are shown");
}

for (const candidate of lbCandidates) {
  const res = await request(`https://api.listenbrainz.org/1/user/${encodeURIComponent(candidate)}/listens?count=50`);
  if (res.error) {
    fail(`could not fetch listens: ${res.error}`, NET_FIX);
    break;
  }
  if (res.status === 404) {
    unknownNames.push(candidate);
    if (lbCandidates.length > 1) info(`ListenBrainz has no user named "${candidate}"; trying the next one`);
    continue;
  }
  const count = res.status === 200 && Array.isArray(res.json?.payload?.listens) ? res.json.payload.listens.length : -1;
  // As on the site: the token's account is yours whatever it holds; among guessed spellings one with listens wins.
  if (candidate !== tokenAccount && count === 0 && lbCandidates.length > 1) {
    emptyAccount ??= { candidate, res };
    info(`"${candidate}" exists but has no listens; trying the next one`);
    continue;
  }
  reportListens(candidate, res);
  break;
}
if (!lbName && emptyAccount) reportListens(emptyAccount.candidate, emptyAccount.res);
if (!lbName && unknownNames.length > 0 && unknownNames.length === lbCandidates.length) {
  fail(`ListenBrainz has no user named ${unknownNames.map((name) => `"${name}"`).join(" or ")}`, "use the name in the address of your profile (listenbrainz.org/user/<name>); several guesses can be listed, separated by commas, semicolons or \"or\"");
}

// ---- GitHub ------------------------------------------------------------------------

heading("4. GitHub repositories and contribution graph");
const ghHeaders = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
const reposUrl = `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated&direction=desc`;
let tokenRejected = false;

let repos = await request(reposUrl, { headers: has("GITHUB_TOKEN") ? { ...ghHeaders, authorization: `Bearer ${ghToken}` } : ghHeaders });
if (!repos.error && repos.status === 401 && has("GITHUB_TOKEN")) {
  tokenRejected = true;
  warn("GitHub rejected GITHUB_TOKEN (401 Bad credentials). The site falls back to anonymous access for repositories");
  info("fix: create a new fine-grained token (Public repositories, read-only) and update GITHUB_TOKEN; it may have expired or been revoked");
  repos = await request(reposUrl, { headers: ghHeaders });
}
if (repos.error) fail(`could not reach api.github.com: ${repos.error}`, NET_FIX);
else if (repos.status === 200 && Array.isArray(repos.json)) {
  // follow Link: rel="next" exactly as the site does (bounded: 20 pages)
  let total = repos.json.length;
  let page = repos;
  const authHeaders = tokenRejected || !has("GITHUB_TOKEN") ? ghHeaders : { ...ghHeaders, authorization: `Bearer ${ghToken}` };
  for (let n = 2; n <= 20 && /rel="next"/.test(page.headers.get("link") ?? ""); n += 1) {
    page = await request(`${reposUrl}&page=${n}`, { headers: authHeaders });
    if (page.error || page.status !== 200 || !Array.isArray(page.json)) break;
    total += page.json.length;
  }
  ok(`${total} public repositories found for ${USERNAME}`);
  info(`rate limit remaining: ${repos.headers.get("x-ratelimit-remaining") ?? "unknown"} of ${repos.headers.get("x-ratelimit-limit") ?? "unknown"}`);
  if (total === 0) warn("this account has no public repositories, so the panel will say 'no public repositories'");
} else if (repos.status === 403 || repos.status === 429) {
  fail(`GitHub is rate limiting this machine (HTTP ${repos.status}); anonymous access allows only 60 requests an hour per IP`, "add a valid GITHUB_TOKEN, or wait until the limit resets");
} else fail(`GitHub answered HTTP ${repos.status} for the repository list`, "try again shortly");

let graphqlOk = false;
if (has("GITHUB_TOKEN") && !tokenRejected) {
  const query = "query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions}}}}";
  const res = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${ghToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  const total = res.json?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions;
  if (res.error) fail(`could not reach the GitHub GraphQL API: ${res.error}`, NET_FIX);
  else if (typeof total === "number") {
    graphqlOk = true;
    ok(`GraphQL works: ${total} contributions in the last year`);
  } else if (res.status === 401) {
    tokenRejected = true;
    warn("GraphQL rejected GITHUB_TOKEN (401); the site will use the public contributions graph instead");
  } else {
    const types = (res.json?.errors ?? []).map((e) => e.type ?? e.message).filter(Boolean).join(", ");
    warn(`GraphQL did not return the calendar (HTTP ${res.status}${types ? `, ${types}` : ""}); the site will use the public contributions graph instead`);
    if (/FORBIDDEN|INSUFFICIENT|not accessible/i.test(types)) info("fine-grained tokens can lack GraphQL access; a classic token with no scopes also works for public data");
  }
} else if (!has("GITHUB_TOKEN")) info("no GITHUB_TOKEN: the calendar will use the public contributions graph");

const pub = await request(`https://github.com/users/${USERNAME}/contributions`, { headers: { accept: "text/html" } });
if (pub.error) {
  if (graphqlOk) warn(`public contributions graph unreachable (${pub.error}); not needed while GraphQL works`);
  else fail(`could not reach github.com for the public contributions graph: ${pub.error}`, NET_FIX);
} else if (pub.status === 200) {
  const days = parsePublicDays(pub.text);
  if (days) ok(`public contributions graph available (${days} days)`);
  else if (graphqlOk) warn("public contributions graph did not have the expected markup; not needed while GraphQL works");
  else fail("the public contributions graph did not have the expected markup (the site cannot use it)", "set a working GITHUB_TOKEN so GraphQL can be used");
} else if (!graphqlOk) fail(`github.com answered HTTP ${pub.status} for the public contributions graph`, "set a working GITHUB_TOKEN so GraphQL can be used");

// ---- summary ---------------------------------------------------------------------------

heading("Summary");
if (problems.length === 0) {
  console.log(`  ${paint(32, "Everything the site needs is reachable from this machine.")}`);
  console.log("  If a panel still shows nothing, restart the server after editing .env.local, then start it with SHOW_DIAGNOSTICS=1 and open /status (or /api/presence, /api/listening, /api/github/projects and /api/github/contributions) to see each panel's status.");
} else {
  console.log(`  ${paint(31, `${problems.length} problem${problems.length === 1 ? "" : "s"} found.`)} Fix the FAIL lines above, restart the server, and run this again.`);
  process.exitCode = 1;
}

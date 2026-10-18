#!/usr/bin/env node
/**
 * `npm run doctor`: checks the dashboard's configuration and every live
 * integration from THIS machine, and says exactly what is wrong and how to fix
 * it. Run it wherever the site runs (your laptop, the server).
 *
 * It only reads. It never prints a credential: environment variables are
 * reported as "set" / "not set" plus whether their format looks right.
 */

import { existsSync } from "node:fs";
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
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "install Node 20.9 or newer");

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const envFiles = [".env.local", ".env", ".env.production", ".env.production.local"].filter((f) => existsSync(join(process.cwd(), f)));
if (envFiles.length) ok(`environment files found: ${envFiles.join(", ")}`);
else fail("no .env.local (or .env) file in this folder", "copy .env.example to .env.local and fill it in, or set the variables in your host's settings; dotfiles are hidden in Finder/Explorer, so check from a terminal with: ls -a");

const env = (name) => (process.env[name] ?? "").trim();
const placeholder = /^(replace[_-]?with|your[_-]|changeme|todo$|xxx+$)/i;
const has = (name) => env(name) !== "" && !placeholder.test(env(name));

const discordId = env("DISCORD_USER_ID");
const lbToken = env("LISTENBRAINZ_TOKEN");
const lbUser = env("LISTENBRAINZ_USERNAME");
const ghToken = env("GITHUB_TOKEN");

if (!has("DISCORD_USER_ID")) {
  fail("DISCORD_USER_ID is not set: the Discord panel will say 'presence not configured'", "set DISCORD_USER_ID=<your numeric Discord ID>");
} else if (/^\d{15,25}$/.test(discordId)) {
  ok("DISCORD_USER_ID is set and looks like a Discord ID");
} else {
  fail("DISCORD_USER_ID is set but is not a numeric Discord ID", "copy your User ID from Discord (Settings > Advanced > Developer Mode, then right-click your profile > Copy User ID)");
}

if (has("LISTENBRAINZ_USERNAME")) ok("LISTENBRAINZ_USERNAME is set (no token is needed to read public listens)");
else if (has("LISTENBRAINZ_TOKEN")) {
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(lbToken)) ok("LISTENBRAINZ_TOKEN is set and has the expected format");
  else warn("LISTENBRAINZ_TOKEN is set but is not in the usual UUID format; it may have been copied incorrectly");
} else fail("neither LISTENBRAINZ_TOKEN nor LISTENBRAINZ_USERNAME is set: the listening panel will say 'listening not configured'", "set LISTENBRAINZ_USERNAME=<your ListenBrainz username> (simplest, nothing secret); a LISTENBRAINZ_TOKEN from https://listenbrainz.org/settings/ also works");

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
    info("the browser also needs to reach wss://api.lanyard.rest/socket for live updates");
  } else if (res.json?.error?.code === "user_not_monitored") {
    fail("Lanyard does not track this Discord account, so the panel will say 'presence not tracked'", "join https://discord.gg/lanyard with this exact Discord account, then wait a minute");
  } else fail(`Lanyard answered HTTP ${res.status}`, "try again shortly; if it persists, check https://status.lanyard.rest or Lanyard's Discord");
}

// ---- ListenBrainz ----------------------------------------------------------------

heading("3. Recently played (ListenBrainz)");
let lbName = has("LISTENBRAINZ_USERNAME") ? lbUser : undefined;
if (!lbName && has("LISTENBRAINZ_TOKEN")) {
  const res = await request("https://api.listenbrainz.org/1/validate-token", { headers: { authorization: `Token ${lbToken}` } });
  if (res.error) fail(`could not reach api.listenbrainz.org: ${res.error}`, NET_FIX);
  else if (res.json?.valid === true && res.json.user_name) {
    lbName = res.json.user_name;
    ok(`token is valid (ListenBrainz user: ${lbName})`);
  } else if (res.status === 429) fail("ListenBrainz is rate limiting this machine", "wait a few minutes and retry");
  else fail(`ListenBrainz rejected the token (HTTP ${res.status}${res.json?.message ? `: ${res.json.message}` : ""})`, "create a new token at https://listenbrainz.org/settings/ and update LISTENBRAINZ_TOKEN");
} else if (!lbName) warn("skipped: no ListenBrainz token or username configured");

if (lbName) {
  const res = await request(`https://api.listenbrainz.org/1/user/${encodeURIComponent(lbName)}/listens?count=50`);
  if (res.error) fail(`could not fetch listens: ${res.error}`, NET_FIX);
  else if (res.status === 404) fail(`ListenBrainz has no user named '${lbName}'`, "check LISTENBRAINZ_USERNAME, or use LISTENBRAINZ_TOKEN instead");
  else if (res.status !== 200 || !Array.isArray(res.json?.payload?.listens)) fail(`listens request answered HTTP ${res.status}`, "try again shortly");
  else {
    const listens = res.json.payload.listens;
    const spotify = listens.filter((l) => {
      const i = l?.track_metadata?.additional_info ?? {};
      return String(i.music_service ?? "").toLowerCase() === "spotify.com" || String(i.music_service_name ?? "").toLowerCase() === "spotify" || String(i.spotify_id ?? "").includes("open.spotify.com/track/");
    }).length;
    if (listens.length === 0) {
      fail("ListenBrainz returned 0 listens for this user, so the panel will say 'no recent listens'", "connect Spotify under ListenBrainz > Settings > Connect services (or import your history), then play something");
    } else {
      ok(`${listens.length} recent listens found (${spotify} marked as coming from Spotify)`);
      const newest = Number(listens[0]?.listened_at);
      if (newest) info(`most recent listen: ${new Date(newest * 1000).toISOString()}`);
      if (spotify > 0 && spotify < listens.length) info("because some listens are marked as Spotify, only those are shown");
    }
  }
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
  const cells = (pub.text.match(/data-date="\d{4}-\d{2}-\d{2}"/g) ?? []).length;
  const tooltips = (pub.text.match(/<tool-tip\b/gi) ?? []).length;
  if (cells >= 300 && (tooltips >= 300 || /data-count="/.test(pub.text))) ok(`public contributions graph available (${cells} days)`);
  else if (graphqlOk) warn("public contributions graph did not have the expected markup; not needed while GraphQL works");
  else fail("the public contributions graph did not have the expected markup", "set a working GITHUB_TOKEN so GraphQL can be used");
} else if (!graphqlOk) fail(`github.com answered HTTP ${pub.status} for the public contributions graph`, "set a working GITHUB_TOKEN so GraphQL can be used");

// ---- summary ---------------------------------------------------------------------------

heading("Summary");
if (problems.length === 0) {
  console.log(`  ${paint(32, "Everything the site needs is reachable from this machine.")}`);
  console.log("  If a panel still shows nothing, restart the server after editing .env.local, then open /api/listening, /api/github/projects and /api/github/contributions in the browser to see each panel's status.");
} else {
  console.log(`  ${paint(31, `${problems.length} problem${problems.length === 1 ? "" : "s"} found.`)} Fix the FAIL lines above, restart the server, and run this again.`);
  process.exitCode = 1;
}

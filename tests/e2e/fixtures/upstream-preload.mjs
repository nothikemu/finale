/**
 * TEST-ONLY. Preloaded into the Next.js server (NODE_OPTIONS=--import) by the
 * Playwright config so end-to-end tests can run without network access or real
 * credentials. It answers GitHub and ListenBrainz requests with deterministic
 * fixtures; it is never part of the application bundle or a production path.
 *
 * FIXTURE_MODE=ok            healthy upstreams (default)
 * FIXTURE_MODE=down          every upstream call fails with 500
 * FIXTURE_MODE=ratelimit     every upstream call answers 429 + Retry-After
 * FIXTURE_MODE=badtoken      GitHub's API answers 401 "Bad credentials" to any request that
 *                            carries a token (as the real API does), but serves anonymous ones
 * FIXTURE_MODE=ok-no-public  healthy, except github.com's public contributions page is 404
 *
 * LANYARD_FIXTURE decides what the SERVER sees at api.lanyard.rest (the browser's view is stubbed per test):
 *   unset / blocked  the request fails like a blocked network, so the server has nothing to offer
 *   ok               the test account is tracked and has a presence
 *   untracked        Lanyard answers 404 user_not_monitored
 *   garbage          Lanyard answers 200 with a payload that is not a presence
 * (FIXTURE_MODE=down and ratelimit still win, as for every other upstream.)
 *
 * LISTENBRAINZ_FIXTURE=blocked  ListenBrainz requests fail like a blocked network (a specific, non-generic cause)
 * FIXTURE_TODAY_OFFSET_DAYS=N   the calendar ends N days from today, to run the suite as if it were another weekday
 */

const realFetch = globalThis.fetch;
const mode = process.env.FIXTURE_MODE ?? "ok";
const DAY = 86_400_000;
// Moves the calendar's "today" by this many days, so a suite can be run as if it were any weekday.
const todayOffsetDays = Number(process.env.FIXTURE_TODAY_OFFSET_DAYS) || 0;

// Small deterministic PRNG so screenshots and assertions are stable.
let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function calendarDays() {
  const today = new Date(Date.now() + todayOffsetDays * DAY);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 364 * DAY);
  start.setTime(start.getTime() - start.getUTCDay() * DAY); // back to Sunday
  const weeks = [];
  let total = 0;
  for (let cursor = start.getTime(); cursor <= today.getTime(); cursor += 7 * DAY) {
    const contributionDays = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(cursor + d * DAY);
      if (date > today) break;
      const roll = random();
      const count = roll < 0.45 ? 0 : roll < 0.7 ? 1 + Math.floor(random() * 3) : roll < 0.9 ? 4 + Math.floor(random() * 6) : 10 + Math.floor(random() * 15);
      const level = count === 0 ? "NONE" : count < 4 ? "FIRST_QUARTILE" : count < 8 ? "SECOND_QUARTILE" : count < 14 ? "THIRD_QUARTILE" : "FOURTH_QUARTILE";
      total += count;
      contributionDays.push({ date: date.toISOString().slice(0, 10), contributionCount: count, contributionLevel: level });
    }
    weeks.push({ contributionDays });
  }
  return { total, weeks };
}

function calendar() {
  const { total, weeks } = calendarDays();
  return { data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: total, weeks } } } } };
}

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The fragment github.com serves at /users/{login}/contributions: one <tr> per weekday, tooltips after the grid. */
function publicCalendarHtml() {
  const { total, weeks } = calendarDays();
  const rows = Array.from({ length: 7 }, () => []);
  const tips = [];
  weeks.forEach((week, col) => {
    for (const day of week.contributionDays) {
      const row = new Date(`${day.date}T00:00:00Z`).getUTCDay();
      const id = `contribution-day-component-${row}-${col}`;
      const level = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"].indexOf(day.contributionLevel);
      rows[row].push(`<td tabindex="-1" data-ix="${col}" aria-selected="false" aria-describedby="contribution-graph-legend-level-${level}" style="width: 10px" data-date="${day.date}" id="${id}" data-level="${level}" role="gridcell" data-view-component="true" class="ContributionCalendar-day"></td>`);
      const date = new Date(`${day.date}T00:00:00Z`);
      const when = `${MONTHS[date.getUTCMonth()]} ${ordinal(date.getUTCDate())}`;
      const text = day.contributionCount === 0 ? `No contributions on ${when}.` : `${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"} on ${when}.`;
      tips.push(`<tool-tip id="tooltip-${row}-${col}" for="${id}" popover="manual" data-direction="n" data-type="label" data-view-component="true" class="sr-only position-absolute">${text}</tool-tip>`);
    }
  });
  const body = rows.map((cells, r) => `<tr style="height: 10px"><td class="ContributionCalendar-label" style="position: relative"><span class="sr-only">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][r]}</span></td>${cells.join("")}</tr>`).join("");
  return `<div class="js-yearly-contributions"><h2 id="js-contribution-activity-description" class="f4 text-normal mb-2">${total.toLocaleString("en-US")} contributions in the last year</h2><table class="ContributionCalendar-grid js-calendar-graph-table"><caption class="sr-only">Contribution Graph</caption><tbody>${body}</tbody></table>${tips.join("")}</div>`;
}

function repos(page) {
  const names = [
    "rocket-sim", "motor-curves", "beat-sampler", "dotfiles", "pcb-notes", "flight-computer", "thrust-stand", "fin-flutter",
    "drum-kit-maker", "arch-setup", "wm-config", "nerd-font-test", "serial-logger", "telemetry-dash", "cad-parts", "mono-site",
    "kerbal-calc", "cfd-scratch", "midi-tools", "keyboard-fw", "nozzle-design", "parachute-sizing", "altimeter-fw", "sd-logger",
    "lathe-notes", "gcode-viewer", "thesis-template", "lab-reports", "matlab-misc", "scratchpad", "old-portfolio", "fork-of-openrocket",
    "bench-scripts", "latex-snippets", "tuning-notes", "hardware-db", "rf-experiments", "noise-gate", "sample-packs", "daw-templates",
  ];
  const all = names.map((name, i) => ({
    id: 1000 + i,
    name,
    full_name: `nothikemu/${name}`,
    html_url: `https://github.com/nothikemu/${name}`,
    description: i % 5 === 3 ? null : i % 7 === 0 ? "A deliberately long description that needs to wrap cleanly across several lines without being truncated away or forcing the row to a fixed height." : `${name.replace(/-/g, " ")} (fixture)`,
    language: i % 6 === 5 ? null : ["TypeScript", "Python", "C++", "Rust", "Shell", "Lua"][i % 6],
    stargazers_count: (i * 7) % 23,
    forks_count: (i * 3) % 5,
    archived: i === 14,
    fork: i === 31,
    private: false,
    updated_at: new Date(Date.now() - (i + 1) * 3 * DAY).toISOString(),
  }));
  return all.slice((page - 1) * 25, page * 25);
}

function listens() {
  const now = Math.floor(Date.now() / 1000);
  const artists = ["Fixture Artist", "Another Fixture", "日本語のアーティスト", "A Very Long Artist Name That Should Wrap Without Breaking The Layout Of The Panel"];
  return Array.from({ length: 50 }, (_, i) => ({
    listened_at: now - 120 - i * 1500,
    recording_msid: `msid-${i}`,
    track_metadata: {
      artist_name: artists[i % artists.length],
      track_name: i % 9 === 4 ? "A long fixture track title with plenty of words to wrap" : `Fixture Track ${i + 1}`,
      release_name: i % 3 === 0 ? null : `Fixture Album ${Math.floor(i / 3)}`,
      additional_info: {
        music_service: "spotify.com",
        spotify_id: i % 4 === 0 ? null : `https://open.spotify.com/track/${"4uLU6hMCjMI75M1A2tKUQC"}`,
      },
      mbid_mapping: null,
    },
  }));
}

/** An account whose client marks only some listens as Spotify, to exercise the "spotify listens only" note. */
function mixedListens() {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: 5 }, (_, i) => ({
    listened_at: now - 300 - i * 600,
    recording_msid: `mixed-${i}`,
    track_metadata: {
      artist_name: "Mixed Artist",
      track_name: i < 3 ? `Spotify Track ${i + 1}` : `Elsewhere Track ${i - 2}`,
      release_name: null,
      additional_info: i < 3 ? { music_service: "spotify.com" } : { submission_client: "some-other-player" },
      mbid_mapping: null,
    },
  }));
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const isGithub = url.hostname === "api.github.com";
  const isGithubWeb = url.hostname === "github.com";
  const isListenBrainz = url.hostname === "api.listenbrainz.org";
  const isLanyard = url.hostname === "api.lanyard.rest";
  if (!isGithub && !isGithubWeb && !isListenBrainz && !isLanyard) return realFetch(input, init);

  if (isListenBrainz && process.env.LISTENBRAINZ_FIXTURE === "blocked") throw new TypeError("fetch failed");
  if (mode === "down") return json({ message: "fixture outage" }, 500);
  if (mode === "ratelimit") return json({ message: "fixture rate limit" }, 429, { "retry-after": "120" });

  // Like the real API, a bad token is refused even on public endpoints.
  if (isGithub && mode === "badtoken" && new Headers(init?.headers).get("authorization")) return json({ message: "Bad credentials" }, 401);

  if (isLanyard) {
    const lanyard = process.env.LANYARD_FIXTURE || "blocked";
    if (lanyard === "blocked") throw new TypeError("fetch failed");
    const id = url.pathname.split("/").pop();
    if (lanyard === "garbage") return json({ success: true, data: { discord_status: "online" } });
    if (lanyard === "untracked" || id !== "100000000000000001") {
      return json({ success: false, error: { code: "user_not_monitored", message: "User is not being monitored by Lanyard" } }, 404);
    }
    return json({
      success: true,
      data: {
        discord_status: "idle",
        active_on_discord_desktop: true,
        kv: { bio: "bio served by the dashboard's server", secret: "kv-secret-must-not-render" },
        discord_user: { id, username: "snapshot_user", global_name: "Snapshot User", avatar: null, discriminator: "0", public_flags: 0 },
        activities: [{ id: "custom", type: 4, name: "Custom Status", state: "read by the server" }],
      },
    });
  }
  if (isGithubWeb) {
    if (mode === "ok-no-public" || url.pathname !== "/users/nothikemu/contributions") return new Response("Not Found", { status: 404 });
    return new Response(publicCalendarHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (isGithub && url.pathname === "/graphql") return json(calendar());
  if (isGithub && url.pathname === "/users/nothikemu/repos") {
    const page = Number(url.searchParams.get("page") ?? "1");
    const next = page < 2 ? { link: `<https://api.github.com/users/nothikemu/repos?page=${page + 1}>; rel="next"` } : {};
    return json(repos(page), 200, next);
  }
  if (isListenBrainz && url.pathname === "/1/validate-token") {
    // Like the real service, a token that was reset is answered 200 with valid:false.
    if (new Headers(init?.headers).get("authorization") === "Token 00000000-0000-4000-8000-000000000000") return json({ code: 200, message: "Token invalid.", valid: false });
    return json({ code: 200, message: "Token valid.", valid: true, user_name: "fixture-user" });
  }
  if (isListenBrainz && url.pathname === "/1/user/fixture-user/listens") return json({ payload: { count: 50, listens: listens() } });
  if (isListenBrainz && url.pathname === "/1/user/fixture-mixed/listens") return json({ payload: { count: 5, listens: mixedListens() } });
  if (isListenBrainz && url.pathname === "/1/user/fixture-mixed/playing-now") return json({ payload: { count: 0, playing_now: true, listens: [] } });
  if (isListenBrainz && url.pathname === "/1/user/fixture-user/playing-now") {
    return json({ payload: { count: 1, playing_now: true, listens: [{ playing_now: true, track_metadata: { artist_name: "Now Playing Artist", track_name: "Now Playing Fixture", release_name: "Fixture Single" } }] } });
  }
  return json({ message: "fixture: unhandled route" }, 404);
};

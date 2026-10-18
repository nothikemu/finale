# nothikemu: personal dashboard

A compact personal dashboard: live Discord presence, social links, recent listening (via ListenBrainz), a short introduction, a full GitHub contribution calendar, and a scrollable list of every public GitHub repository.

Precision-cut smoked glass over an OLED-black page: true `#000` background, quartz-white (`#f4f1ec`) accents, JetBrainsMono Nerd Font Mono everywhere, square corners only.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · plain CSS with centralised tokens · inline SVG
- **Server components** render structure and initial data; **small client islands** handle only what is live (Discord socket, listening refresh, calendar tooltip, word taps).
- **Read-only:** the site never writes to Discord, GitHub or ListenBrainz.

## Quick start

```bash
npm install
npm run dev                  # open the address it prints, normally http://localhost:3000
```

**Settings.** If you were given a ready-made `.env.local` (a hidden file beside `package.json`), leave it alone: **do not copy `.env.example` over it**, which would replace your values with blanks. Only if you have none, create one from the template without overwriting anything and fill it in (see [Configuration](#configuration)):

```bash
[ -f .env.local ] || cp .env.example .env.local                                  # macOS / Linux
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }           # Windows PowerShell
```

Requires Node 20.9+. Production: `npm run build && npm start` (stop any server that is already running first; two copies cannot share a port, and the browser keeps showing the old one. Use the address the terminal prints. `/status` shows which build and folder you are talking to). Run the doctor as `npm run doctor`; plain `npm doctor` is a different, built-in npm command.

**A panel shows nothing?** Open **<http://localhost:3000/status>** (the port your server prints), or run `npm run doctor`. Either one shows what the server actually received and checks every live service, then says what to fix. See [Troubleshooting](#troubleshooting).

With nothing configured the site still runs: each integration shows an understated "not configured" (or, if it cannot be reached, "unavailable") state, and in development only, the variable to set. Nothing is ever faked.

## Configuration

Set these in `.env.local` for development and in your host's secret manager for production. `.env.example` has placeholders only; **never commit real values.**

**Public identifiers can also live in the project.** A Discord user ID and a ListenBrainz username are not secrets (anyone who can see your profile can see them), so `src/config/identity.ts` accepts them too. Use it when your host never receives `.env.local` (Vercel, Netlify and similar upload only committed files). An environment variable of the same name always wins. **Credentials (`GITHUB_TOKEN`, `LISTENBRAINZ_TOKEN`) are environment-only and are never read from that file.**

| Variable | Needed for | Secret? | Notes |
| --- | --- | --- | --- |
| `DISCORD_USER_ID` | Discord panel | No (public ID) | Numeric Discord user ID. Not inferred from the GitHub username; there is no default. |
| `LISTENBRAINZ_USERNAME` | Recently played | No | Your ListenBrainz username, the name in your profile address (`listenbrainz.org/user/<name>`; pasting the whole address works). Public listens need no token. Unsure of the spelling? List several (`nothikemu,hikemu`, or `nothikemu or hikemu`): the first one that exists and has listens is used. |
| `LISTENBRAINZ_TOKEN` | Recently played | **Yes, server only** | Optional. Used once (cached 6 h) to ask ListenBrainz whose token it is via `GET /1/validate-token`; a valid token decides the account. Never sent to the browser. If it is rejected (for example after you reset it), the username is used instead. |
| `GITHUB_TOKEN` | Contribution calendar (required), projects (optional, raises rate limit) | **Yes, server only** | See below for the least-privilege setup. |
| `SHOW_DIAGNOSTICS` | Troubleshooting | No | `1` shows owner-only hints inside failing panels and enables `/status`. `0` hides them everywhere, even on your own machine (to preview the visitor view). Unset: hints show in `npm run dev` and when the page is opened from the machine running the server (`localhost`); remote visitors never see them. |
| `PROFILE_BANNER_URL` | Discord banner | No | Optional `https://` image. Last-resort fallback: used only if Lanyard returns no banner and the `banner` KV key is empty. |
| `PROFILE_BIO` | Discord bio | No | Optional text. Last-resort fallback: used only if Lanyard returns no bio and the `bio` KV key is empty. |

### Discord (Lanyard)

1. In Discord: **Settings → Advanced → Developer Mode** on, then right-click your profile → **Copy User ID**.
2. Join the Lanyard Discord server (<https://discord.gg/UrXF2cfJ7F>, the invite in [Lanyard's README](https://github.com/Phineas/lanyard)) with that account. Lanyard only tracks users who are in its server; otherwise the panel shows "presence not tracked".
3. Set `DISCORD_USER_ID`.

The browser talks to Lanyard directly (`GET https://api.lanyard.rest/v1/users/{id}` once for first paint, plus one shared `wss://api.lanyard.rest/socket` subscription). Handshake, heartbeat at the advertised interval, jittered exponential reconnect, and cleanup are implemented in `src/data/discord/lanyard-store.ts` and unit-tested with a fake socket.

**Second route through the server.** If the visitor's browser cannot get presence from Lanyard (an ad blocker, a VPN, a firewall), the panel asks this site's own server instead (`/api/presence`, which reads the same public REST endpoint, with no credential involved and a 10 s cache). It keeps asking every 30 s while the socket is not live, and the panel is then labelled "stale · reconnecting" rather than "live". The server's answer is never preferred over live data from the browser. Only the owner-approved KV keys appear in it.

What Lanyard does **not** guarantee, and how the panel handles it honestly:

- **Banner / bio come from Lanyard KV.** Lanyard only relays Discord's gateway presence, which contains no banner and no "About Me", so the supported way to publish them through Lanyard is its key-value store. The panel reads exactly two approved keys, `bio` and `banner` (configured in `site.discord.kv` in `src/config/site.ts`). In the Lanyard Discord server, use the Lanyard bot's `.set` command, for example `.set bio mechanical engineering student` and `.set banner https://example.com/banner.png` (see the KV section of <https://github.com/Phineas/lanyard> for the exact syntax). Changes arrive over the live socket.
  - **Precedence:** a banner or bio Lanyard genuinely returned in the presence data, then the approved KV key, then `PROFILE_BANNER_URL` / `PROFILE_BIO`. With none of them, the banner area shows a quartz glass material instead of a fabricated Discord banner, and no bio is shown. Custom status is never shown as the bio.
  - **Safety:** KV values are public and owner-controlled, so the bio is sanitised and rendered as text only, and the banner must be an `https://` URL without credentials. Any other KV key is never read or rendered; the panel never dumps KV.
- **Badges:** derived from `public_flags` only. Nitro and boosting are not in that data, so they are never shown.
- **Unreachable vs offline:** when neither the browser nor the server can get presence, the panel shows "presence unavailable" (or "stale · reconnecting" with last-known data), never "offline".

### ListenBrainz

ListenBrainz is not a direct Spotify-history endpoint. Your Spotify listening must already be flowing into ListenBrainz: connect Spotify under **ListenBrainz → Settings → Connect services** (or import your history).

**Simplest and safest: set `LISTENBRAINZ_USERNAME` to your ListenBrainz username.** Public listens need no token, so there is nothing secret to protect. The username is the name in your profile address, `https://listenbrainz.org/user/<name>/`; pasting that whole address works too.

**Not sure how it is spelled?** Several candidates may be listed, separated by commas, semicolons or the word "or" (`LISTENBRAINZ_USERNAME=nothikemu,hikemu`). A leading `@` and a pasted profile address are understood. They are tried in order; the first one ListenBrainz knows **and that has listens** is used (an account that exists but is empty only wins if every spelling is empty). Names from the environment and from `src/config/identity.ts` are combined, not replaced. A name ListenBrainz has never heard of is skipped, but a temporary error never moves on to the next name, so a hiccup cannot show someone else's listens. If none exists the panel says so and the owner hint lists what was tried. `npm run doctor` and `/status` print the account that was found.

**A token settles it.** If `LISTENBRAINZ_TOKEN` (from <https://listenbrainz.org/settings/>) is also set and valid, ListenBrainz itself says whose account it is, and that wins over any guess. The server asks once (cached 6 h) via `GET /1/validate-token`, and the token never reaches the browser. If the token is missing, rejected or cannot be checked, the username (or candidate list) is used, so resetting a token does not take the panel down.

The panel fetches `GET /1/user/{name}/listens?count=50` (cached 60 s) and optionally `/playing-now` (cached 20 s; the client refreshes every 30 s while the page is visible). If ListenBrainz marks listens with Spotify-origin metadata, only those are shown; otherwise all listens are shown under the neutral "recently played / via listenbrainz" labels and no listen is claimed to be Spotify.

> **Treat any token that was ever pasted into a chat, prompt, issue or commit as compromised.** Reset it at <https://listenbrainz.org/settings/> and enter the new one only in your secret manager, or switch to `LISTENBRAINZ_USERNAME` and stop using a token at all.

### GitHub

Create a **fine-grained personal access token** with *Repository access: Public repositories (read-only)* and no extra permissions. That keeps private repositories and private-contribution detail out of reach. The GraphQL contribution calendar requires a token; REST repository listing works without one.

The calendar prefers GitHub's GraphQL API. If that is unavailable (no token, or a token GitHub rejects or does not allow to use GraphQL), it falls back to the public contributions graph that github.com serves to everyone, which shows the same public data, so the calendar works even with no token. This fallback reads an undocumented page, so it is parsed defensively and fails closed ("unavailable") rather than guessing; set `site.github.publicCalendarFallback` to `false` in `src/config/site.ts` to use GraphQL only. A token that GitHub rejects also never hides your repositories: the list falls back to anonymous access.

The calendar labels its total "contributions" (GitHub's calendar includes more than commits) and shows GitHub's own default period. Projects include forks and archived repositories (labelled), follow `Link: rel="next"` pagination until every public repository is retrieved, and sort by most recently updated.

## Troubleshooting

Panels say what is wrong in plain words ("listening not configured", "github projects unavailable"). To find out **why**, work down this list:

1. **Open `/status`** (for example <http://localhost:3000/status>). It is a plain-text report from the *running server*: which settings arrived and where from (never their values), then one live check each for Discord (Lanyard), ListenBrainz (with the account it found) and GitHub, and what to do about every FAIL. It works on the machine running the server without any setting, and on a hosted site once diagnostics are on (see the table). Visitors get a 404. If something still looks wrong, paste the page to whoever is helping you; it contains no credentials.
2. **Run `npm run doctor`** in the project folder, on the machine that runs the site. It reports on your env file (including UTF-16 saves, a `.env.local.txt`, shell variables that override the file, and `NODE_ENV=test`), then every service. It does not see a *hosted* site's settings; use `/status` there.
3. **Open the status routes** in your browser: `/api/listening`, `/api/presence`, `/api/github/projects`, `/api/github/contributions`. A failing one returns `{"status":"unavailable","reason":"auth","detail":"github-graphql: auth (401)"}` or `{"status":"missing-config",...}`.
4. **Hints inside panels.** They appear in `npm run dev`, when you open the page on the machine running the server (a request that came through a proxy or CDN never counts as local), and anywhere `SHOW_DIAGNOSTICS=1` (or `showDiagnostics: true` in `src/config/identity.ts`) is set. Turn them off with `SHOW_DIAGNOSTICS=0`.
5. **Restart the server** after changing `.env.local`; environment files are read at startup. Stop any old server first: a second `npm start` on the same port fails while the browser keeps showing the old one.

Common causes:

| Symptom | Cause and fix |
| --- | --- |
| Discord says "presence not configured" and listening says "listening not configured", while the two GitHub panels work | **The settings never reached the server.** GitHub needs no credentials, so it looks fine either way. Locally: `.env.local` must be named exactly that (Explorer hides `.txt`), sit next to `package.json`, be saved as UTF-8 (PowerShell's `>` writes UTF-16, which is ignored), and the server must be restarted. A variable already set in your shell overrides the file. On Vercel, Netlify and similar hosts `.env.local` is **never uploaded**: add the variables in the host's *Environment Variables*, make sure they apply to the Production environment, and **redeploy** (they are not applied to a running deployment). Or set `discordUserId` and `listenbrainzUsername` in `src/config/identity.ts`, which travels with the project (run `npm run build` again after editing it). `/status` shows exactly what arrived, the files it found, and the build that is running. |
| The Discord panel stays on grey bars and never changes | The page's scripts did not start. In `npm run dev`, Next.js refuses its dev socket when the page is opened by anything but `localhost` (a LAN IP, a tunnel, sometimes `127.0.0.1`), so open `http://localhost:PORT`. After about 14 seconds the panel says so itself. Also check the browser console. |
| The site works locally but my deployed copy is missing these fixes | A host deploys the branch you point it at. Merge or push the branch you want live. |
| Discord says "presence not tracked" | Lanyard only tracks accounts in its server. Join <https://discord.gg/UrXF2cfJ7F> with that exact account. |
| Discord says "presence unavailable" | Neither the browser nor this site's server could get presence. With `SHOW_DIAGNOSTICS=1` the panel says why, for example `the browser could not reach api.lanyard.rest; the dashboard's server could not get it either (lanyard: network)`. Run `npm run doctor`: if it can reach Lanyard, the cause is between the running server and the internet (see the proxy row below). |
| Discord shows data but says "stale · reconnecting" | The live socket (`wss://api.lanyard.rest/socket`) is blocked for that visitor, so the panel is showing the server's snapshot, refreshed every 30 s. Allow the socket to get live updates. |
| Listening says "no recent listens" | ListenBrainz has no listens for you. Connect Spotify under ListenBrainz > Settings > Connect services, then play something. |
| Listening says "unavailable" with `not-found` | ListenBrainz has no user by that name. Use the name in your profile address (`listenbrainz.org/user/<name>`), or list several spellings separated by commas. A valid `LISTENBRAINZ_TOKEN` also finds the right name by itself. |
| Listening says "unavailable" with `auth` | The ListenBrainz token was rejected and no username is set. Put your username in `LISTENBRAINZ_USERNAME` (public listens need no token), or copy a fresh token from <https://listenbrainz.org/settings/>. |
| Everything from GitHub is "unavailable" with `rate-limited` | GitHub allows 60 anonymous requests an hour per IP. Add a valid `GITHUB_TOKEN`, or wait. |
| Every server-side panel is "unavailable" with `network` | The machine running the server cannot reach the internet. Node's built-in `fetch` ignores `HTTP(S)_PROXY` unless you start it with `NODE_USE_ENV_PROXY=1` (Node 22.21+ or 24+). Behind a TLS-inspecting proxy also set `NODE_EXTRA_CA_CERTS`. |
| A GitHub token was rejected (401) | The site still shows your public repositories and the public calendar. Create a new fine-grained token to restore the GraphQL calendar. |

## Deployment

Any Node 20.9+ host works (`npm run build && npm start`), including Vercel, Netlify and Docker. Cloudflare Pages/Workers are not supported as they are (the app uses Node APIs and an in-process cache). Set the environment variables in the host's secret manager; **`.env.local` is for your own machine and is not uploaded by most hosts.** After deploying, open `/status` on the deployed site (set `SHOW_DIAGNOSTICS=1` in the host's variables, or `showDiagnostics: true` in `src/config/identity.ts`, temporarily) if a panel is empty. Variables added in a host's dashboard apply only to *new* deployments, and only in the environment (Production, Preview) they were added to.

Upstream results are cached **in process** (15 min projects, 30 min calendar, 60 s listens, 20 s now-playing) with request de-duplication, `Retry-After` cool-downs, and last-known-good data served (and labelled "showing last known data") when a refresh fails. On serverless platforms each instance has its own cache; the API routes also send CDN `Cache-Control` headers, so edge caching absorbs most traffic.

Production responses carry a locked-down Content-Security-Policy (see `next.config.ts`). If you embed new third-party hosts, extend it there.

## Design system

Everything visual comes from `src/styles/tokens.css`.

- **Material:** 1px border, faint inset top highlight, faint dark shadow, **one** 12-16px backdrop blur per panel (never nested), and a few extremely low-opacity static quartz light fields behind the page so the glass has something to refract. No WebGL, no animated glass.
- **Opaque fallback / reduced transparency:** panels are opaque where `backdrop-filter` is unsupported, when the visitor sets `prefers-reduced-transparency` or `prefers-contrast: more`, or if you set `glass: "opaque"` in `src/config/site.ts` (renders `<html data-glass="opaque">`). CSS override: `:root[data-glass="opaque"] .panel { … }` in `src/styles/panel.css`.
- **Motion:** one 280 ms entrance fade (6 px, 30 ms stagger), 180 ms link transitions, and three localised word effects. `prefers-reduced-motion` removes all animation; the word effects keep a polished static state (also what touch devices see at rest).
- **Font:** JetBrainsMono Nerd Font Mono (Nerd Fonts v3.4.0), self-hosted as WOFF2 in `public/fonts/` with `font-display: swap` and preload. It is the real patched font, subset to Latin plus common symbols and Powerline glyphs, not ordinary JetBrains Mono. Rebuild or change the subset with `npm run fonts` (needs `pip install fonttools brotli`; the script verifies the family name). License: `public/fonts/OFL.txt`.
- **Headings** are written lowercase and rendered uppercase with 0.08em tracking via CSS.

### The about-panel word effects

`rocket` (stepped 2-3 px lift with a small square-pixel exhaust), `beats` (tiny square-ended equalizer bars; purely decorative and not audio-reactive), `enjoyer` (scan highlight over a stepped underline). They play on pointer hover and on touch/pen tap; the copy stays real text, decoration is `aria-hidden`, and nothing shifts layout. They are plain text, deliberately **not** focusable or button-like, so keyboard users do not get three empty tab stops.

## Project structure

```
src/
  app/                 layout, page, icon, API routes (/api/listening, /api/github/projects, /api/github/contributions)
  components/          Dashboard + one component per panel (DiscordPresence, SocialLinks, RecentListening, About, ContributionCalendar, GitHubProjects)
  config/site.ts       owner-editable copy, links, cache lifetimes
  data/                adapters, kept separate from visuals
    github/            contributions (GraphQL) and projects (REST)
    discord/           Lanyard parsing, asset resolution, badges, shared socket store
    listenbrainz.ts    token validation, listens, playing-now
    types.ts           normalised models + the Loaded<T> state union
  lib/                 sanitising, formatting, calendar geometry, server cache + upstream HTTP
  styles/              tokens, base, layout, panel shell, per-panel styles, word effects
tests/unit             Vitest: adapters, validation, cache, Lanyard store
tests/e2e              Playwright: layout, content, interaction, states, accessibility
scripts/build-fonts.py reproducible font build
scripts/doctor.mjs     `npm run doctor`: live connectivity and configuration report
```

Every data panel has distinct **loading** (static skeleton), **success**, **legitimately empty**, **missing configuration**, **temporarily unavailable** and **stale** states, and one failed integration never breaks the page: panels stream and fail independently. External API responses are validated at runtime (zod on the server, hand-written guards in the browser), text is sanitised (bidi/control characters stripped) and only ever rendered as text, and outbound URLs must be `https` and, for artwork and Spotify links, on an allow-listed host.

## Testing

```bash
npm run lint
npm run typecheck
npm test              # unit tests (Vitest)
npm run test:e2e      # builds, starts eleven servers, runs Playwright
```

The e2e suite needs no credentials or live services (run `npx playwright install chromium` once if Playwright has no browser yet). It starts the production build eleven times: healthy upstreams, nothing configured, a total upstream outage, a rejected GitHub token, an outage with owner diagnostics, a no-credentials run with GitHub's public pages, a run where the server (but not the browser) can reach Lanyard, one with nothing configured and owner hints on, one with nothing configured and `SHOW_DIAGNOSTICS` unset (the owner is recognised by viewing from localhost), one with only guessed ListenBrainz usernames, and one where ListenBrainz is unreachable (to check that the page, the API and `/status` agree on the cause). Upstream GitHub/ListenBrainz responses come from `tests/e2e/fixtures/upstream-preload.mjs`, a **test-only** `NODE_OPTIONS=--import` preload that is never part of the app; Lanyard (REST and WebSocket) is mocked inside the browser, and the server's own view of Lanyard is selected per server by `LANYARD_FIXTURE`. Fake secrets are used so the suite can prove they never reach HTML, scripts, API responses or storage.

## Verification

Results at release (Chromium via Playwright, Node 22):

| Check | Result |
| --- | --- |
| Unit tests | 169 passed |
| End-to-end tests | 172 passed, consecutive runs on a fresh build (layout, content, interaction, states, security, accessibility, cross-state consistency, resilience, doctor) |
| ESLint, `tsc --noEmit`, production `next build` | clean |
| `npm audit --omit=dev` | 0 vulnerabilities (dev-only advisories exist in test tooling) |
| axe-core (WCAG 2.0-2.2 A/AA + best practices), 1440 px and 390 px | 0 violations |

The acceptance checklist, mapped to tests:

- **Six panels in the design's hierarchy; four across the top; calendar about 2/3, projects about 1/3:** measured at 1440 × 900: container 1376 px, 32 px margins, 16 px gaps, rows 390/360 px, panel widths 382/282/332/332 and 907/453 px. Breakpoints at 1200, 1199, 768 and 767 asserted. No horizontal page scroll at 14 widths from 320 to 1920 px.
- **No rounded corners:** every element and `::before`/`::after` has a computed `border-radius` of 0.
- **OLED black and quartz-only accents:** asserted on computed colours; font actually loaded (both weights, `document.fonts`).
- **Socials, personal copy, three word effects:** exact hrefs/handles; about text asserted verbatim; each effect animates on hover without layout shift and is inert under reduced motion.
- **Discord:** honest handling of absent fields, one shared socket, live updates, stale/unavailable/untracked states, no invented badges, only the two approved KV keys read (bio sanitised, banner https-only), KV never dumped.
- **ListenBrainz token never reaches the browser:** the fake token is absent from HTML, every script and JSON response, and storage; the browser makes no direct call to ListenBrainz or GitHub.
- **Scroll regions:** native scrolling, hidden scrollbar, named and keyboard-focusable, headings stay put; all 40 fixture repositories (two Link-paginated pages) reachable.
- **Calendar:** every returned day is a square cell with an accessible date and count, totals match, month/weekday labels, legend and period present, nothing cropped on desktop, scrolls inside the panel on mobile and opens on the latest week, keyboard arrow navigation, tap/focus tooltips.
- **Reduced motion / reduced transparency / 200% text:** covered.

### Performance (Lighthouse 12, production build, headless Chromium, localhost)

| Profile | Performance | Accessibility | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- |
| Desktop preset | 99 | 100 | 0.8 s | 0 | 0 ms |
| Mobile, no throttling | 100 | 100 | 0.5 s | 0 | 0 ms |
| Mobile, simulated slow 4G + 4x CPU (Lighthouse default) | 91 | 100 | **3.4 s** | 0.05 | 120 ms |

Honest reading: the simulated-mobile LCP misses the 2.5 s target. On a phone-sized viewport the first screen is dominated by the Discord panel, which is deliberately rendered client-side from Lanyard (as specified), so its content appears after hydration, and Lighthouse's 4x CPU throttle makes that slow. Our own client code is about 8 KB gzipped; the rest is React/Next. If you want a faster mobile LCP, fetch the first presence on the server and seed the client store (a trade-off against the "read Lanyard directly" requirement). CLS with a rich mocked presence payload on a 390 px viewport was 0.035 (below 0.1); real devices were not measured. In the measured run the Lanyard host was unreachable, which Lighthouse reports as a console error.

### Live integrations

**GitHub** was exercised against the real GitHub with a real account during development: the app returned all of the account's public repositories and its GraphQL calendar, and the real public contributions page parses correctly (365 contiguous days, with a total equal to GitHub's own heading).

**Lanyard and ListenBrainz** could not be reached from the build environment, so those two rest on their published sources (Lanyard's README for the REST and WebSocket protocol; ListenBrainz's `views/api.py` for `validate-token`, `listens` and `playing-now`, which need no token for public listens), fixtures and unit tests. Run `npm run doctor` on your machine to confirm them against the real services.

## Setup checklist

1. `DISCORD_USER_ID`, and joining the Lanyard server so the account is tracked.
2. `LISTENBRAINZ_USERNAME` (no secret needed; or a freshly reset `LISTENBRAINZ_TOKEN` in the deployment's secret manager), and Spotify connected to ListenBrainz.
3. `GITHUB_TOKEN`: fine-grained, public repositories read-only.
4. To show a banner and bio: set the `banner` and `bio` keys in Lanyard KV (see the Discord section), or use the `PROFILE_BANNER_URL` / `PROFILE_BIO` fallbacks.

## Design notes

- Three social links ship: Twitter/X, GitHub and guns.lol.
- The guns.lol icon is a generic square link glyph; no reliable official glyph was available.
- Rows in the socials panel stack label above handle so all three look identical at the 282 px reference width.
- Scroll regions fade out over their last 20 px instead of showing a scroll icon.

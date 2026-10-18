# nothikemu: personal dashboard

A compact personal dashboard: live Discord presence, social links, recent listening (via ListenBrainz), a short introduction, a full GitHub contribution calendar, and a scrollable list of every public GitHub repository.

Precision-cut smoked glass over an OLED-black page: true `#000` background, quartz-white (`#f4f1ec`) accents, JetBrainsMono Nerd Font Mono everywhere, square corners only.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · plain CSS with centralised tokens · inline SVG
- **Server components** render structure and initial data; **small client islands** handle only what is live (Discord socket, listening refresh, calendar tooltip, word taps).
- **Read-only:** the site never writes to Discord, GitHub or ListenBrainz.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill it in (see "Configuration")
npm run dev                  # http://localhost:3000
```

Requires Node 20.9+. Production: `npm run build && npm start`.

**A panel shows nothing?** Run `npm run doctor`. It checks your environment file and every live service from your machine and tells you exactly what is wrong and how to fix it. See [Troubleshooting](#troubleshooting).

With nothing configured the site still runs: each integration shows an understated "not configured" (or, if it cannot be reached, "unavailable") state, and in development only, the variable to set. Nothing is ever faked.

## Configuration

Set these in `.env.local` for development and in your host's secret manager for production. `.env.example` has placeholders only; **never commit real values.**

| Variable | Needed for | Secret? | Notes |
| --- | --- | --- | --- |
| `DISCORD_USER_ID` | Discord panel | No (public ID) | Numeric Discord user ID. Not inferred from the GitHub username; there is no default. |
| `LISTENBRAINZ_TOKEN` | Recently played | **Yes, server only** | Used once (cached 6 h) to resolve your username via `GET /1/validate-token`. Never sent to the browser. |
| `LISTENBRAINZ_USERNAME` | Recently played | No | Optional. If set, token validation is skipped and this username is used directly. |
| `GITHUB_TOKEN` | Contribution calendar (required), projects (optional, raises rate limit) | **Yes, server only** | See below for the least-privilege setup. |
| `SHOW_DIAGNOSTICS` | Troubleshooting | No | Set to `1` to show owner-only hints inside failing panels of a production build (they always show in `npm run dev`). |
| `PROFILE_BANNER_URL` | Discord banner | No | Optional `https://` image. Last-resort fallback: used only if Lanyard returns no banner and the `banner` KV key is empty. |
| `PROFILE_BIO` | Discord bio | No | Optional text. Last-resort fallback: used only if Lanyard returns no bio and the `bio` KV key is empty. |

### Discord (Lanyard)

1. In Discord: **Settings → Advanced → Developer Mode** on, then right-click your profile → **Copy User ID**.
2. Join the Lanyard Discord server (<https://discord.gg/lanyard>) with that account. Lanyard only tracks users who are in its server; otherwise the panel shows "presence not tracked".
3. Set `DISCORD_USER_ID`.

The browser talks to Lanyard directly (`GET https://api.lanyard.rest/v1/users/{id}` once for first paint, plus one shared `wss://api.lanyard.rest/socket` subscription). Handshake, heartbeat at the advertised interval, jittered exponential reconnect, and cleanup are implemented in `src/data/discord/lanyard-store.ts` and unit-tested with a fake socket.

What Lanyard does **not** guarantee, and how the panel handles it honestly:

- **Banner / bio come from Lanyard KV.** Lanyard only relays Discord's gateway presence, which contains no banner and no "About Me", so the supported way to publish them through Lanyard is its key-value store. The panel reads exactly two approved keys, `bio` and `banner` (configured in `site.discord.kv` in `src/config/site.ts`). In the Lanyard Discord server, use the Lanyard bot's `.set` command, for example `.set bio mechanical engineering student` and `.set banner https://example.com/banner.png` (see the KV section of <https://github.com/Phineas/lanyard> for the exact syntax). Changes arrive over the live socket.
  - **Precedence:** a banner or bio Lanyard genuinely returned in the presence data, then the approved KV key, then `PROFILE_BANNER_URL` / `PROFILE_BIO`. With none of them, the banner area shows a quartz glass material instead of a fabricated Discord banner, and no bio is shown. Custom status is never shown as the bio.
  - **Safety:** KV values are public and owner-controlled, so the bio is sanitised and rendered as text only, and the banner must be an `https://` URL without credentials. Any other KV key is never read or rendered; the panel never dumps KV.
- **Badges:** derived from `public_flags` only. Nitro and boosting are not in that data, so they are never shown.
- **Unreachable vs offline:** a disconnected API shows "presence unavailable" (or "stale · reconnecting" with last-known data), never "offline".

### ListenBrainz

ListenBrainz is not a direct Spotify-history endpoint. Your Spotify listening must already be flowing into ListenBrainz: connect Spotify under **ListenBrainz → Settings → Connect services** (or import your history). Then copy your user token from <https://listenbrainz.org/settings/>.

The panel fetches `GET /1/user/{name}/listens?count=50` (cached 60 s) and optionally `/playing-now` (cached 20 s; the client refreshes every 30 s while the page is visible). If ListenBrainz marks listens with Spotify-origin metadata, only those are shown; otherwise all listens are shown under the neutral "recently played / via listenbrainz" labels and no listen is claimed to be Spotify.

> **Reset your ListenBrainz token.** If it was ever pasted into a prompt, issue or chat it is compromised. Reset it at <https://listenbrainz.org/settings/> and enter the new one only in your secret manager.

### GitHub

Create a **fine-grained personal access token** with *Repository access: Public repositories (read-only)* and no extra permissions. That keeps private repositories and private-contribution detail out of reach. The GraphQL contribution calendar requires a token; REST repository listing works without one.

The calendar prefers GitHub's GraphQL API. If that is unavailable (no token, or a token GitHub rejects or does not allow to use GraphQL), it falls back to the public contributions graph that github.com serves to everyone, which shows the same public data, so the calendar works even with no token. This fallback reads an undocumented page, so it is parsed defensively and fails closed ("unavailable") rather than guessing; set `site.github.publicCalendarFallback` to `false` in `src/config/site.ts` to use GraphQL only. A token that GitHub rejects also never hides your repositories: the list falls back to anonymous access.

The calendar labels its total "contributions" (GitHub's calendar includes more than commits) and shows GitHub's own default period. Projects include forks and archived repositories (labelled), follow `Link: rel="next"` pagination until every public repository is retrieved, and sort by most recently updated.

## Troubleshooting

Panels say what is wrong in plain words ("listening not configured", "github projects unavailable"). To find out **why**, work down this list:

1. **Run `npm run doctor`** in the project folder, on the machine that runs the site. It prints PASS / WARN / FAIL for your env file, Lanyard, ListenBrainz and GitHub, with a fix for each FAIL. It never prints a credential.
2. **Open the status routes** in your browser: `/api/listening`, `/api/github/projects`, `/api/github/contributions`. A failing one returns `{"status":"unavailable","reason":"auth","detail":"github-graphql: auth (401)"}` or `{"status":"missing-config",...}`.
3. **Turn on hints.** `npm run dev` shows a one-line explanation inside each failing panel. For a production build set `SHOW_DIAGNOSTICS=1`.
4. **Restart the server** after changing `.env.local`; environment files are read at startup.

Common causes:

| Symptom | Cause and fix |
| --- | --- |
| Everything says "not configured" | The environment file is not being read. It must be named `.env.local` and sit next to `package.json`. File managers hide dotfiles, so check with `ls -a`. Hosts such as Vercel and Netlify do **not** upload `.env.local`; add the variables in the host's settings instead. |
| Discord says "presence not tracked" | Lanyard only tracks accounts in its server. Join <https://discord.gg/lanyard> with that exact account. |
| Discord says "presence unavailable" | The browser cannot reach `api.lanyard.rest` (ad blocker, VPN, firewall). Open the browser console. |
| Listening says "no recent listens" | ListenBrainz has no listens for you. Connect Spotify under ListenBrainz > Settings > Connect services, then play something. |
| Listening says "unavailable" with `auth` | The ListenBrainz token is wrong. Copy a fresh one from <https://listenbrainz.org/settings/>. |
| Everything from GitHub is "unavailable" with `rate-limited` | GitHub allows 60 anonymous requests an hour per IP. Add a valid `GITHUB_TOKEN`, or wait. |
| Every server-side panel is "unavailable" with `network` | The machine running the server cannot reach the internet. Node's built-in `fetch` ignores `HTTP(S)_PROXY` unless you start it with `NODE_USE_ENV_PROXY=1` (Node 22.21+ or 24+). Behind a TLS-inspecting proxy also set `NODE_EXTRA_CA_CERTS`. |
| A GitHub token was rejected (401) | The site still shows your public repositories and the public calendar. Create a new fine-grained token to restore the GraphQL calendar. |

## Deployment

Any Node 20.9+ host works (`npm run build && npm start`), including Vercel and Docker. Set the environment variables in the host's secret manager; **`.env.local` is for your own machine and is not uploaded by most hosts.** After deploying, run `npm run doctor` with the same variables (or set `SHOW_DIAGNOSTICS=1` temporarily) if a panel is empty.

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
npm run test:e2e      # builds, starts three servers, runs Playwright
```

The e2e suite needs no credentials or live services (run `npx playwright install chromium` once if Playwright has no browser yet). It starts the production build three times: healthy upstreams, nothing configured, and a total upstream outage. Upstream GitHub/ListenBrainz responses come from `tests/e2e/fixtures/upstream-preload.mjs`, a **test-only** `NODE_OPTIONS=--import` preload that is never part of the app; Lanyard (REST and WebSocket) is mocked inside the browser. Fake secrets are used so the suite can prove they never reach HTML, scripts, API responses or storage.

## Verification

Results at release (Chromium via Playwright, Node 22):

| Check | Result |
| --- | --- |
| Unit tests | 85 passed |
| End-to-end tests | 121 passed (layout, content, interaction, states, security, accessibility, cross-state consistency, resilience, doctor) |
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

The automated tests use fixtures for GitHub and ListenBrainz and a mocked Lanyard, so **no automated run has exercised the real services**. Their response shapes are implemented from the public documentation and covered by fixtures and unit tests; after configuring, open each panel once with real credentials.

## Setup checklist

1. `DISCORD_USER_ID`, and joining the Lanyard server so the account is tracked.
2. `LISTENBRAINZ_TOKEN` (reset first, per the note above) in the deployment's secret manager, and Spotify connected to ListenBrainz.
3. `GITHUB_TOKEN`: fine-grained, public repositories read-only.
4. To show a banner and bio: set the `banner` and `bio` keys in Lanyard KV (see the Discord section), or use the `PROFILE_BANNER_URL` / `PROFILE_BIO` fallbacks.

## Design notes

- Three social links ship: Twitter/X, GitHub and guns.lol.
- The guns.lol icon is a generic square link glyph; no reliable official glyph was available.
- Rows in the socials panel stack label above handle so all three look identical at the 282 px reference width.
- Scroll regions fade out over their last 20 px instead of showing a scroll icon.

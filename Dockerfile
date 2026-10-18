# syntax=docker/dockerfile:1
# A small production image: `docker build -t dashboard .`, then run it with your settings, e.g.
#   docker run -p 3000:3000 -e DISCORD_USER_ID=... -e LISTENBRAINZ_USERNAME=... -e GITHUB_TOKEN=... \
#              -e SITE_URL=https://your.domain dashboard
# (.env.local is not copied into the image: pass settings as environment variables. tests/ stays in the build
# context on purpose: `next build` type-checks playwright.config.ts, which imports from it; the final image
# contains none of it.)

FROM node:22-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 nextjs
COPY --from=build --chown=nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

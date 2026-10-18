# A small production image: `docker build -t dashboard .`, then run it with your settings, e.g.
#   docker run -p 3000:3000 -e DISCORD_USER_ID=... -e LISTENBRAINZ_USERNAME=... -e GITHUB_TOKEN=... dashboard
# (.env.local is not copied into the image: pass settings as environment variables.)
# syntax=docker/dockerfile:1

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
CMD ["node", "server.js"]

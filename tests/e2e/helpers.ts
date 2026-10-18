import type { Page, WebSocketRoute } from "@playwright/test";
import { TEST_DISCORD_ID } from "./constants";

/** 1x1 PNG so external artwork never produces network noise offline. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export function presenceFixture(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    discord_status: "online",
    active_on_discord_desktop: true,
    active_on_discord_mobile: true,
    active_on_discord_web: false,
    listening_to_spotify: true,
    spotify: {
      track_id: "4uLU6hMCjMI75M1A2tKUQC",
      song: "Fixture Song",
      artist: "Fixture Artist; Second Artist",
      album: "Fixture Album",
      album_art_url: "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789",
      timestamps: { start: now - 80_000, end: now + 120_000 },
    },
    kv: { bio: "kv value that must not be shown", secret: "kv-secret-must-not-render" },
    discord_user: {
      id: TEST_DISCORD_ID,
      username: "fixture_user",
      global_name: "Fixture User",
      avatar: "0123456789abcdef0123456789abcdef",
      discriminator: "0",
      public_flags: (1 << 6) | (1 << 22),
    },
    activities: [
      { id: "custom", type: 4, name: "Custom Status", state: "tinkering with a fixture", emoji: { name: "🚀" } },
      { id: "game", type: 0, name: "Fixture Game", details: "In the hangar", state: "Level 3", application_id: "1234567890123456", timestamps: { start: now - 3_700_000 }, assets: { large_image: "9876543210" } },
      { id: "spotify:1", type: 2, name: "Spotify" },
    ],
    ...overrides,
  };
}

export interface LanyardMock {
  /** Every socket the page opened, in order. */
  sockets: WebSocketRoute[];
  /** Frames the page sent, across all sockets. */
  received: { op: number; d?: unknown }[];
  push(data: unknown): void;
}

/** Stubs Lanyard's REST endpoint and socket, and every external image host. */
export async function mockLanyard(page: Page, data: unknown = presenceFixture(), options: { rest?: "ok" | "untracked" | "down"; socket?: "ok" | "down" } = {}): Promise<LanyardMock> {
  const mock: LanyardMock = {
    sockets: [],
    received: [],
    push(next) {
      mock.sockets.at(-1)?.send(JSON.stringify({ op: 0, seq: 2, t: "PRESENCE_UPDATE", d: next }));
    },
  };

  await page.route(/https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net|i\.scdn\.co|coverartarchive\.org)\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );

  await page.route("https://api.lanyard.rest/v1/users/*", (route) => {
    if (options.rest === "down") return route.abort();
    if (options.rest === "untracked") {
      return route.fulfill({ status: 404, json: { success: false, error: { code: "user_not_monitored", message: "User is not being monitored by Lanyard" } } });
    }
    return route.fulfill({ json: { success: true, data } });
  });

  await page.routeWebSocket("wss://api.lanyard.rest/socket", (ws) => {
    mock.sockets.push(ws);
    if (options.socket === "down") {
      void ws.close();
      return;
    }
    ws.send(JSON.stringify({ op: 1, d: { heartbeat_interval: 30_000 } }));
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { op: number; d?: unknown };
      mock.received.push(frame);
      if (frame.op === 2) ws.send(JSON.stringify({ op: 0, seq: 1, t: "INIT_STATE", d: data }));
    });
  });
  return mock;
}

export const panel = (page: Page, id: string) => page.locator(`.panel--${id}`);

/** Waits for finite animations (the entrance fade) to finish so geometry is measured at rest. */
export async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

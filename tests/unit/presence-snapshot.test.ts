import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPresence } from "@/data/discord/snapshot";
import { clearCache } from "@/lib/server/cache";

const ID = "100000000000000001"; // test fixture, not the owner's ID

const lanyardBody = (extra: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    discord_status: "online",
    kv: { bio: "approved bio", secret: "kv-secret-must-not-leak" },
    discord_user: { id: ID, username: "tester", global_name: "Tester", discriminator: "0" },
    activities: [],
    ...extra,
  },
});

const urls: string[] = [];
function mockLanyard(handler: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      urls.push(String(input));
      return handler();
    }),
  );
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  clearCache();
  urls.length = 0;
  process.env.DISCORD_USER_ID = ID;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DISCORD_USER_ID;
});

describe("loadPresence", () => {
  it("reads Lanyard's REST endpoint and keeps only approved fields", async () => {
    mockLanyard(() => json(lanyardBody()));
    const result = await loadPresence();
    expect(urls).toEqual([`https://api.lanyard.rest/v1/users/${ID}`]);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.tracked).toBe(true);
    expect(result.data.presence?.user.displayName).toBe("Tester");
    expect(result.data.presence?.kvBio).toBe("approved bio");
    expect(JSON.stringify(result)).not.toContain("kv-secret-must-not-leak");
  });

  it("caches briefly so visitors cannot hammer Lanyard", async () => {
    mockLanyard(() => json(lanyardBody()));
    await loadPresence();
    await loadPresence();
    await loadPresence();
    expect(urls).toHaveLength(1);
  });

  it("reports an account Lanyard does not track as not tracked, not as an outage", async () => {
    mockLanyard(() => json({ success: false, error: { code: "user_not_monitored", message: "nope" } }, 404));
    const result = await loadPresence();
    expect(result).toMatchObject({ status: "ok", data: { tracked: false, presence: null } });
  });

  it("says which field is wrong when Lanyard sends something unreadable", async () => {
    mockLanyard(() => json({ success: true, data: { discord_status: "online" } }));
    const result = await loadPresence();
    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-response" });
    expect(result.status === "unavailable" && result.detail).toContain("discord_user is missing");
  });

  it("treats success:false and non-JSON bodies as invalid", async () => {
    mockLanyard(() => json({ success: false }));
    expect(await loadPresence()).toMatchObject({ status: "unavailable", reason: "invalid-response" });
    clearCache();
    mockLanyard(() => new Response("<html>gateway</html>", { status: 200 }));
    expect(await loadPresence()).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("reports an unreachable Lanyard as a network failure", async () => {
    mockLanyard(() => {
      throw new TypeError("fetch failed");
    });
    const result = await loadPresence();
    expect(result).toMatchObject({ status: "unavailable", reason: "network" });
    expect(result.status === "unavailable" && result.detail).toContain("lanyard: network");
  });

  it("needs a valid DISCORD_USER_ID and does not call Lanyard without one", async () => {
    mockLanyard(() => json(lanyardBody()));
    delete process.env.DISCORD_USER_ID;
    expect(await loadPresence()).toEqual({ status: "missing-config", missing: ["DISCORD_USER_ID"] });
    process.env.DISCORD_USER_ID = "../../etc/passwd";
    expect(await loadPresence()).toEqual({ status: "missing-config", missing: ["DISCORD_USER_ID"] });
    expect(urls).toHaveLength(0);
  });

  it("serves a recent snapshot as stale when a refresh fails, but not an old one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    mockLanyard(() => json(lanyardBody()));
    expect((await loadPresence()).status).toBe("ok");

    mockLanyard(() => json({ message: "down" }, 500));
    vi.setSystemTime(new Date("2026-10-18T12:01:00Z"));
    expect(await loadPresence()).toMatchObject({ status: "ok", stale: true });

    // Past the failed refresh's cool-down, and past the two minutes a snapshot may be shown as current.
    vi.setSystemTime(new Date("2026-10-18T12:03:30Z"));
    expect(await loadPresence()).toMatchObject({ status: "unavailable" });
  });
});

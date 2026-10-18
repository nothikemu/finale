import { expect, test } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard, panel, presenceFixture } from "./helpers";

/**
 * Discord is the one panel whose data normally comes straight from the visitor's
 * browser. When something between the visitor and api.lanyard.rest (an ad
 * blocker, a VPN, a firewall) gets in the way, the panel falls back to this
 * site's own server, which reads the same Lanyard endpoint.
 */

test.describe("the browser cannot reach Lanyard, but the server can", () => {
  test.use({ baseURL: URLS.serverLanyard });

  test("shows the server's snapshot, honestly labelled as not live", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord.locator(".discord__name")).toHaveText("Snapshot User");
    await expect(discord).toContainText("idle");
    await expect(discord.locator(".discord__bio")).toHaveText("bio served by the dashboard's server");
    await expect(discord).toContainText("read by the server");
    await expect(discord.locator(".discord__connection")).toContainText("stale");
    await expect(discord.locator(".discord__connection")).not.toHaveText("live");
    await expect(discord).not.toContainText("presence unavailable");
    // only the approved KV keys are ever shown
    await expect(discord).not.toContainText("kv-secret-must-not-render");
  });

  test("works when only the socket is blocked: REST gives first paint, the server keeps it from going stale unseen", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "ok", socket: "down" });
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord.locator(".discord__name")).toHaveText("Fixture User");
    await expect(discord.locator(".discord__connection")).toContainText("stale");
  });

  test("live data from the browser wins, and the server's snapshot is never requested", async ({ page }) => {
    const snapshotRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/presence") snapshotRequests.push(request.url());
    });
    await mockLanyard(page);
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord.locator(".discord__name")).toHaveText("Fixture User");
    await expect(discord.locator(".discord__connection")).toHaveText("live");
    expect(snapshotRequests).toEqual([]);
  });

  test("an account Lanyard reports as untracked is not papered over by the server", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "untracked", socket: "down" });
    await page.goto("/");
    await expect(panel(page, "discord")).toContainText("presence not tracked");
  });

  test("/api/presence serves normalised presence and nothing from unapproved KV keys", async ({ request }) => {
    const response = await request.get("/api/presence");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("s-maxage");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", data: { tracked: true, presence: { status: "idle", user: { displayName: "Snapshot User" } } } });
    expect(JSON.stringify(body)).not.toContain("kv-secret-must-not-render");
  });
});

test.describe("neither route works", () => {
  test("owner diagnostics name both causes", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.goto(URLS.outageDiagnostics);
    const discord = panel(page, "discord");
    await expect(discord).toContainText("presence unavailable");
    const hint = discord.locator(".state__hint");
    await expect(hint).toContainText("the browser could not reach api.lanyard.rest");
    await expect(hint).toContainText("the dashboard's server could not get it either");
    await expect(hint).toContainText("lanyard: upstream (500)");
  });

  test("visitors get no owner hints in production", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.goto(URLS.outage);
    const discord = panel(page, "discord");
    await expect(discord).toContainText("presence unavailable");
    await expect(discord.locator(".state__hint")).toHaveCount(0);
    await expect(discord).not.toContainText("api.lanyard.rest");
  });
});

test.describe("/api/presence states", () => {
  test("a server that cannot reach Lanyard says so with the cause", async ({ request }) => {
    const response = await request.get(`${URLS.healthy}/api/presence`);
    expect(response.status()).toBe(502);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "unavailable", reason: "network", detail: "lanyard: network" });
  });

  test("an upstream outage is reported as such", async ({ request }) => {
    const response = await request.get(`${URLS.outage}/api/presence`);
    expect(response.status()).toBe(502);
    expect(await response.json()).toMatchObject({ status: "unavailable", reason: "upstream" });
  });

  test("without a Discord ID there is nothing to look up", async ({ request }) => {
    const response = await request.get(`${URLS.unconfigured}/api/presence`);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ status: "missing-config", missing: ["DISCORD_USER_ID"] });
  });
});

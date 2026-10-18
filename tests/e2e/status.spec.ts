import { expect, test } from "@playwright/test";
import { FAKE_SECRETS, URLS } from "./constants";
import { mockLanyard, panel, presenceFixture } from "./helpers";

/**
 * /status is the owner's one-stop report of what the running server sees. It must
 * not exist for visitors, must never contain a credential, and must make a
 * configuration that never arrived obvious.
 */

test.describe("visitors", () => {
  for (const [name, base] of [
    ["healthy", URLS.healthy],
    ["unconfigured", URLS.unconfigured],
    ["outage", URLS.outage],
  ] as const) {
    test(`get a plain 404 on the ${name} production server`, async ({ request }) => {
      const response = await request.get(`${base}/status`);
      expect(response.status()).toBe(404);
      expect(await response.text()).toBe("Not found");
    });
  }
});

test.describe("the owner, with diagnostics on", () => {
  test("sees what this server received and a passing check for every integration", async ({ request }) => {
    const response = await request.get(`${URLS.serverLanyard}/status`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    const text = await response.text();

    expect(text).toMatch(/DISCORD_USER_ID\s+set, from environment/);
    expect(text).toMatch(/LISTENBRAINZ_TOKEN\s+set, from environment\s+\(credential, hidden\)/);
    expect(text).toMatch(/LISTENBRAINZ_USERNAME\s+not set/);
    expect(text).toMatch(/SHOW_DIAGNOSTICS\s+set, from environment/);

    expect(text).toMatch(/PASS\s+discord \(lanyard\)\s+tracked, status idle/);
    expect(text).toMatch(/PASS\s+listenbrainz\s+account "fixture-user": 50 listens/);
    expect(text).toMatch(/PASS\s+github projects\s+40 public repositories/);
    expect(text).toMatch(/PASS\s+github contributions\s+\d+ contributions/);
    expect(text).toContain("everything this server can check is working");
    expect(text).not.toContain("FAIL");
  });

  test("shows the build, the folder, the public IDs in use and what environment files sit there", async ({ request }) => {
    const text = await (await request.get(`${URLS.serverLanyard}/status`)).text();
    expect(text).toMatch(/build\s+\S+ \(made \d{4}-\d\d-\d\d \d\d:\d\d UTC\)/);
    expect(text).toMatch(/folder\s+\//);
    expect(text).toContain("Discord ID in use:  100000000000000001 (18 digits");
    expect(text).toContain("environment files in that folder");
    // names and sizes only: a file's contents never appear
    for (const secret of Object.values(FAKE_SECRETS)) expect(text).not.toContain(secret);
  });

  test("never prints a credential", async ({ request }) => {
    for (const base of [URLS.serverLanyard, URLS.badToken, URLS.outageDiagnostics, URLS.unconfiguredDiagnostics]) {
      const text = await (await request.get(`${base}/status`)).text();
      for (const secret of Object.values(FAKE_SECRETS)) expect(text, base).not.toContain(secret);
    }
  });

  test("names every failing integration and what to do about it during an outage", async ({ request }) => {
    const text = await (await request.get(`${URLS.outageDiagnostics}/status`)).text();
    expect(text).toMatch(/FAIL\s+discord \(lanyard\)/);
    expect(text).toMatch(/FAIL\s+listenbrainz/);
    expect(text).toMatch(/FAIL\s+github projects/);
    expect(text).toMatch(/FAIL\s+github contributions/);
    expect(text).toContain("what to do");
  });

  test("shows the public fallback working while GitHub rejects the token", async ({ request }) => {
    const text = await (await request.get(`${URLS.badToken}/status`)).text();
    expect(text).toMatch(/PASS\s+github projects\s+40 public repositories/);
    expect(text).toMatch(/PASS\s+github contributions/);
  });
});

test.describe("when no configuration reaches the server", () => {
  test.use({ baseURL: URLS.unconfiguredDiagnostics });

  test("/status says so, for local and hosted setups, and says what to change", async ({ request }) => {
    const text = await (await request.get("/status")).text();
    for (const key of ["DISCORD_USER_ID", "LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN", "GITHUB_TOKEN"]) expect(text).toMatch(new RegExp(`${key}\\s+not set`));
    expect(text).toMatch(/FAIL\s+discord \(lanyard\)\s+DISCORD_USER_ID did not reach this server/);
    expect(text).toMatch(/FAIL\s+listenbrainz\s+neither LISTENBRAINZ_USERNAME nor LISTENBRAINZ_TOKEN reached this server/);
    expect(text).toContain("must be in .env.local next to package.json");
    expect(text).toContain("on Vercel, Netlify or similar: .env.local is never uploaded");
    expect(text).toContain("src/config/identity.ts");
    expect(text).not.toContain("Open /status");
    // GitHub needs no credential, which is exactly why it can look fine while the others are empty
    expect(text).toMatch(/PASS\s+github projects/);
  });

  test("each panel tells the owner where to look instead of just saying 'not configured'", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord).toContainText("presence not configured");
    await expect(discord.locator(".state__hint")).toContainText("DISCORD_USER_ID did not reach this server");
    await expect(discord.locator(".state__hint")).toContainText("/status");
    const listening = panel(page, "listening");
    await expect(listening).toContainText("listening not configured");
    await expect(listening.locator(".state__hint")).toContainText("did not reach this server");
    await expect(listening.locator(".state__hint")).toContainText("/status");
  });
});

test("the working server's pages never link to /status", async ({ page }) => {
  await mockLanyard(page, presenceFixture());
  await page.goto(`${URLS.serverLanyard}/`);
  await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
  expect(await page.locator('a[href*="status"]').count()).toBe(0);
});

test.describe("the owner is recognised by viewing from the machine running the server", () => {
  const NOT_LOCAL = { host: "dashboard.example.com" };

  test("a browser on localhost gets hints and /status without any setting", async ({ page, request }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto(`${URLS.localViewer}/`);
    await expect(panel(page, "discord").locator(".state__hint")).toContainText("DISCORD_USER_ID did not reach this server");
    await expect(panel(page, "listening").locator(".state__hint")).toContainText("/status");

    const response = await request.get(`${URLS.localViewer}/status`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("you are viewing it from the machine running the server (visitors get a 404)");
    expect(text).toMatch(/DISCORD_USER_ID\s+not set/);
  });

  test("the same server shows a visitor on a public hostname nothing of the sort", async ({ request }) => {
    const status = await request.get(`${URLS.localViewer}/status`, { headers: NOT_LOCAL });
    expect(status.status()).toBe(404);

    const html = await (await request.get(`${URLS.localViewer}/`, { headers: NOT_LOCAL })).text();
    expect(html).toContain("presence not configured");
    expect(html).toContain("listening not configured");
    expect(html).not.toContain("did not reach this server");
    expect(html).not.toContain("DISCORD_USER_ID");
    expect(html).not.toContain("/status");
  });

  test("a request that came through a proxy is never taken for the owner, even if the proxy rewrote Host to localhost", async ({ request }) => {
    for (const header of ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip"]) {
      const status = await request.get(`${URLS.localViewer}/status`, { headers: { [header]: "203.0.113.9" } });
      expect(status.status(), header).toBe(404);
      const html = await (await request.get(`${URLS.localViewer}/`, { headers: { [header]: "203.0.113.9" } })).text();
      expect(html, header).not.toContain("did not reach this server");
    }
  });

  test("SHOW_DIAGNOSTICS=0 hides hints from the owner too, for previewing the visitor view", async ({ page, request }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto(`${URLS.unconfigured}/`);
    await expect(panel(page, "discord")).toContainText("presence not configured");
    await expect(panel(page, "discord").locator(".state__hint")).toHaveCount(0);
    expect((await request.get(`${URLS.unconfigured}/status`)).status()).toBe(404);
  });
});

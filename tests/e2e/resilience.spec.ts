import { expect, test } from "@playwright/test";
import { FAKE_SECRETS, URLS } from "./constants";
import { expireLanyardSettleTimer, mockLanyard, panel } from "./helpers";

/** What the owner would see when GitHub rejects the token, when there is no token, and when things fail. */

async function calendarIsReal(page: import("@playwright/test").Page) {
  const cells = await page.locator(".calendar__svg rect").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!));
  expect(cells.length).toBeGreaterThan(350);
  const sum = cells.reduce((total, label) => total + (label.startsWith("no") ? 0 : Number(label.split(" ")[0]!.replace(/,/g, ""))), 0);
  expect(Number((await page.locator(".calendar__number").textContent())!.replace(/,/g, ""))).toBe(sum);
  expect(sum).toBeGreaterThan(0);
}

test.describe("GitHub rejects the token (401 Bad credentials)", () => {
  test.use({ baseURL: URLS.badToken });

  test("projects and the contribution graph still show the public data", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "projects").locator(".project").first()).toBeVisible();
    await expect(panel(page, "projects").locator(".project")).toHaveCount(40);
    await page.locator(".calendar__svg").waitFor();
    await calendarIsReal(page);
    // nothing is reported as broken, so there is no failure hint on the page
    expect(await page.locator(".dashboard .state").evaluateAll((els) => els.map((el) => el.textContent))).toEqual([]);
  });

  test("the API routes answer with data, and the token is nowhere in them", async ({ request }) => {
    for (const path of ["/api/github/projects", "/api/github/contributions"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(await response.text()).not.toContain(FAKE_SECRETS.GITHUB_TOKEN);
    }
    const calendar = (await (await request.get("/api/github/contributions")).json()).data;
    expect(calendar.weeks.flat().length).toBeGreaterThan(350);
    expect(calendar.total).toBeGreaterThan(0);
  });
});

test.describe("no credentials at all, but GitHub's public pages work", () => {
  test.use({ baseURL: URLS.publicOnly });

  test("the repository list and the contribution graph need no token", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "projects").locator(".project")).toHaveCount(40);
    await page.locator(".calendar__svg").waitFor();
    await calendarIsReal(page);
  });

  test("only the panels that truly need a credential say so", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "discord")).toContainText("presence not configured");
    await expect(panel(page, "listening")).toContainText("listening not configured");
    await expect(panel(page, "activity")).not.toContainText("not configured");
    await expect(panel(page, "projects")).not.toContainText("unavailable");
  });

  test("the calendar looks identical whichever source supplied it", async ({ page, browser }) => {
    // 3101 uses GraphQL, 3106 the public graph: same structure, geometry and styling
    await mockLanyard(page);
    await page.goto(`${URLS.healthy}/`);
    await page.locator(".calendar__svg").waitFor();
    const fromGraphql = await page.locator(".calendar__svg").evaluate((svg) => ({ rows: svg.querySelectorAll('[role="row"]').length, size: svg.getAttribute("viewBox")!.split(" ").slice(2).join("x"), cell: svg.querySelector("rect")!.getAttribute("width") }));
    const other = await browser.newPage();
    await mockLanyard(other);
    await other.goto(`${URLS.publicOnly}/`);
    await other.locator(".calendar__svg").waitFor();
    const fromPublic = await other.locator(".calendar__svg").evaluate((svg) => ({ rows: svg.querySelectorAll('[role="row"]').length, size: svg.getAttribute("viewBox")!.split(" ").slice(2).join("x"), cell: svg.querySelector("rect")!.getAttribute("width") }));
    expect(fromPublic).toEqual(fromGraphql);
    await other.close();
  });
});

test.describe("owner diagnostics (SHOW_DIAGNOSTICS=1)", () => {
  test.use({ baseURL: URLS.outageDiagnostics });

  test("every failing panel says which service failed and what to do, without leaking secrets", async ({ page }) => {
    await page.clock.install();
    const mock = await mockLanyard(page, undefined, { rest: "down", socket: "down" });
    await page.goto("/");
    await expireLanyardSettleTimer(page, mock);

    const hints = await page.locator(".dashboard .state__hint").allTextContents();
    expect(hints.length).toBe(4);
    const text = hints.join(" | ");
    expect(text).toMatch(/listenbrainz[a-z-]*: upstream/);
    expect(text).toMatch(/github-graphql: upstream/);
    expect(text).toMatch(/github-repos: upstream/);
    expect(text).toMatch(/api\.lanyard\.rest/);
    expect(text).toMatch(/npm run doctor/);
    for (const secret of Object.values(FAKE_SECRETS)) expect(await page.content()).not.toContain(secret);
  });

  test("the failure is still shown as unavailable text for visitors, and the page stays whole", async ({ page }) => {
    await mockLanyard(page);
    const response = await page.goto("/");
    expect(response!.status()).toBe(200);
    await expect(panel(page, "listening")).toContainText("listening history unavailable");
    await expect(panel(page, "socials").locator("a")).toHaveCount(3);
  });
});

test.describe("the page's scripts never start (for instance a dev server opened by an IP address)", () => {
  // The note appears after 14 s by design, so these two cases wait for real time.
  test.setTimeout(45_000);

  async function blockScripts(page: import("@playwright/test").Page) {
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
  }

  test("a visitor sees a calm 'still connecting' instead of a skeleton that never ends", async ({ page }) => {
    await blockScripts(page);
    await page.goto(URLS.healthy, { waitUntil: "domcontentloaded" });
    const note = panel(page, "discord").locator(".discord__late");
    await expect(note).toHaveCSS("opacity", "0");
    await expect(note).toHaveCSS("opacity", "1", { timeout: 20_000 });
    await expect(note).toHaveText("still connecting…");
  });

  test("the owner is told what to do about it", async ({ page }) => {
    await blockScripts(page);
    await page.goto(URLS.serverLanyard, { waitUntil: "domcontentloaded" });
    const note = panel(page, "discord").locator(".discord__late");
    await expect(note).toHaveCSS("opacity", "1", { timeout: 20_000 });
    await expect(note).toContainText("this page's scripts did not start");
    await expect(note).toContainText("http://localhost:PORT");
  });

  test("when the scripts do run, the note is never shown", async ({ page }) => {
    await mockLanyard(page);
    await page.goto(URLS.healthy);
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    await expect(panel(page, "discord").locator(".discord__late")).toHaveCount(0);
  });
});

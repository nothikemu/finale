import { expect, test, type Page } from "@playwright/test";
import { FAKE_SECRETS, URLS } from "./constants";
import { mockLanyard, panel } from "./helpers";

test.describe("missing configuration (nothing set)", () => {
  test.use({ baseURL: URLS.unconfigured });

  test("every dependent panel shows an intentional, understated state and the page still renders", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");

    await expect(panel(page, "discord")).toContainText("presence not configured");
    await expect(panel(page, "listening")).toContainText("listening not configured");
    await expect(panel(page, "activity")).toContainText("github activity not configured");
    // projects need no credentials, so they still load
    await expect(panel(page, "projects").locator(".project").first()).toBeVisible();
    // static panels are unaffected
    await expect(panel(page, "socials").locator("a")).toHaveCount(3);
    await expect(panel(page, "about")).toContainText("mechanical engineering student");
  });

  test("never fabricates data: no sample tracks, no invented repositories, no 'online' Discord state", async ({ page }) => {
    const lanyardCalls: string[] = [];
    page.on("request", (r) => r.url().includes("lanyard") && lanyardCalls.push(r.url()));
    await page.goto("/");
    await expect(panel(page, "listening").locator(".track")).toHaveCount(0);
    await expect(panel(page, "activity").locator("rect")).toHaveCount(0);
    await expect(panel(page, "discord")).not.toContainText(/online|idle|do not disturb/);
    // no Discord ID, so nothing may be requested from Lanyard on a guessed ID
    expect(lanyardCalls).toEqual([]);
  });

  test("the setup state is a polite status region, and no secret values appear", async ({ page }) => {
    await page.goto("/");
    await expect(panel(page, "discord").locator("[role=status]")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(FAKE_SECRETS.GITHUB_TOKEN);
  });
});

test.describe("upstream outage", () => {
  test.use({ baseURL: URLS.outage });

  test("failed integrations show unavailable states and do not break the page", async ({ page }) => {
    await mockLanyard(page);
    const response = await page.goto("/");
    expect(response!.status()).toBe(200);
    await expect(panel(page, "listening")).toContainText("listening history unavailable");
    await expect(panel(page, "activity")).toContainText("github activity unavailable");
    await expect(panel(page, "projects")).toContainText("github projects unavailable");
    // the others are fine
    await expect(panel(page, "discord").locator(".discord__name")).toHaveText("Fixture User");
    await expect(panel(page, "socials").locator("a")).toHaveCount(3);
    await expect(panel(page, "about")).toBeVisible();
  });

  test("API routes answer with typed failures rather than leaking upstream detail", async ({ request }) => {
    for (const path of ["/api/listening", "/api/github/projects", "/api/github/contributions"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(502);
      // typed and safe: which service failed and how, never a credential or upstream body
      const body = await response.json();
      expect(body).toMatchObject({ status: "unavailable", reason: "upstream" });
      expect(body.detail).toMatch(/^[a-z:.-]+: upstream( \(\d+\))?$/);
      expect(JSON.stringify(body)).not.toContain(FAKE_SECRETS.GITHUB_TOKEN);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  });
});

test.describe("secrets stay on the server", () => {
  test("neither token appears in HTML, scripts, API responses or storage", async ({ page, request }) => {
    const bodies: string[] = [];
    page.on("response", async (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (/text|javascript|json/.test(type)) bodies.push(await response.text().catch(() => ""));
    });
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".panel--listening .track").first().waitFor();
    await page.waitForLoadState("networkidle");

    for (const path of ["/api/listening", "/api/github/projects", "/api/github/contributions"]) {
      const response = await request.get(path);
      bodies.push(await response.text(), JSON.stringify(response.headers()));
    }
    bodies.push(await page.content());
    bodies.push(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage, cookie: document.cookie })));

    expect(bodies.length).toBeGreaterThan(5);
    for (const body of bodies) {
      for (const secret of Object.values(FAKE_SECRETS)) expect(body).not.toContain(secret);
    }
    // nor is it referenced as a public env var anywhere in the client code
    expect(bodies.join("\n")).not.toMatch(/NEXT_PUBLIC_(LISTENBRAINZ|GITHUB)/);
  });

  test("no network request from the browser goes to ListenBrainz or GitHub directly", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).hostname));
    await mockLanyard(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(hosts.has("api.listenbrainz.org")).toBe(false);
    expect(hosts.has("api.github.com")).toBe(false);
    expect(hosts.has("api.lanyard.rest")).toBe(true);
  });

  test("API routes are read-only", async ({ request }) => {
    for (const path of ["/api/listening", "/api/github/projects", "/api/github/contributions"]) {
      for (const method of ["post", "put", "patch", "delete"] as const) {
        expect((await request[method](path)).status()).toBe(405);
      }
    }
  });
});

test.describe("security headers", () => {
  test("production responses carry a locked-down CSP and no framework banner", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("the page runs under that CSP without violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
});

test.describe("no unwanted behaviour", () => {
  async function load(page: Page) {
    await mockLanyard(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  }

  test("no nav, splash, audio, custom cursor, canvas/WebGL or scroll libraries", async ({ page }) => {
    await load(page);
    expect(await page.locator("nav, header[role=banner], audio, video, canvas, iframe").count()).toBe(0);
    const cursor = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => !["auto", "default", "pointer", "text"].includes(getComputedStyle(el).cursor)).length);
    expect(cursor).toBe(0);
    const scripts = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /lenis|locomotive|gsap|three|particles|smooth-scroll/i.test(n)));
    expect(scripts).toEqual([]);
  });

  test("no continuous animation loops on the page after the entrance", async ({ page }) => {
    await load(page);
    await page.waitForTimeout(800);
    const infinite = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => (a.effect?.getTiming().iterations ?? 1) === Infinity)
        .map((a) => (a as CSSAnimation).animationName),
    );
    // only the slow skeleton fade may loop, and none are left once data has arrived
    expect(infinite).toEqual([]);
  });

  test("native scrolling is not hijacked: wheel and key scrolling move the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 500 });
    await load(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(8, 8);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  });
});

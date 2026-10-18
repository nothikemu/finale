import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard, panel, presenceFixture } from "./helpers";

/** What makes it a real, deployed website: previews, crawlers, a 404, security headers. */

const meta = (html: string, key: string) => new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, "i").exec(html)?.[1];

test.describe("link previews and metadata", () => {
  test("carry the title, description, card type and an absolute image on this host", async ({ request }) => {
    const html = await (await request.get(`${URLS.healthy}/`)).text();
    expect(meta(html, "og:title")).toBe("nothikemu");
    expect(meta(html, "og:description")).toContain("discord presence");
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "og:image")).toMatch(/^http:\/\/localhost:3101\/opengraph-image\.png/);
    expect(meta(html, "twitter:image")).toMatch(/^http:\/\/localhost:3101\/twitter-image\.png/);
    expect(meta(html, "og:image:alt")).toContain("live discord presence");
    expect(html).toMatch(/<link rel="canonical" href="http:\/\/localhost:3101"/);
  });

  test("use the public address when the request came through a proxy", async ({ request }) => {
    const html = await (await request.get(`${URLS.healthy}/`, { headers: { "x-forwarded-host": "dashboard.example.com", "x-forwarded-proto": "https" } })).text();
    expect(meta(html, "og:image")).toMatch(/^https:\/\/dashboard\.example\.com\/opengraph-image\.png/);
    expect(html).toContain('rel="canonical" href="https://dashboard.example.com"');
  });

  test("the preview card, Twitter card and Apple icon are real images", async ({ request }) => {
    for (const [path, size] of [
      ["/opengraph-image.png", 1200],
      ["/twitter-image.png", 1200],
      ["/apple-icon.png", 180],
    ] as const) {
      const response = await request.get(`${URLS.healthy}${path}`);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toBe("image/png");
      const body = await response.body();
      expect(body.readUInt32BE(16), `${path} width`).toBe(size);
    }
  });

  test("the web manifest names the site and uses the same colours", async ({ request }) => {
    const manifest = await (await request.get(`${URLS.healthy}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ name: "nothikemu", start_url: "/", background_color: "#000000", theme_color: "#000000" });
  });
});

test.describe("crawlers", () => {
  test("robots.txt allows the page and keeps the API and the owner's report out", async ({ request }) => {
    const text = await (await request.get(`${URLS.healthy}/robots.txt`)).text();
    expect(text).toMatch(/User-Agent: \*/i);
    expect(text).toMatch(/Allow: \//);
    expect(text).toMatch(/Disallow: \/api\//);
    expect(text).toMatch(/Disallow: \/status/);
  });

  test("the JSON routes and /status say noindex themselves", async ({ request }) => {
    for (const url of [`${URLS.healthy}/api/listening`, `${URLS.healthy}/api/presence`, `${URLS.healthy}/api/github/projects`, `${URLS.serverLanyard}/status`]) {
      const response = await request.get(url);
      expect(response.headers()["x-robots-tag"], url).toBe("noindex, nofollow");
    }
  });
});

test.describe("security headers on a production build", () => {
  test("pages are HTTPS-only for a year and isolate their window", async ({ request }) => {
    const headers = (await request.get(`${URLS.healthy}/`)).headers();
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});

test.describe("a page that does not exist", () => {
  test("is a real 404, kept out of search results, in the dashboard's own material", async ({ page, request }) => {
    const response = await request.get(`${URLS.healthy}/no/such/page`);
    expect(response.status()).toBe(404);
    expect(meta(await response.text(), "robots")).toContain("noindex");

    await page.goto(`${URLS.healthy}/no/such/page`);
    const notice = page.locator(".panel.notice");
    await expect(notice.locator("h1")).toHaveText("not found");
    await expect(notice).toContainText("nothing lives at this address");
    await expect(notice.getByRole("link", { name: "back to the dashboard" })).toHaveAttribute("href", "/");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgb(0, 0, 0)");
    expect(await notice.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
  });

  test("the way back works", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto(`${URLS.healthy}/missing`);
    await page.getByRole("link", { name: "back to the dashboard" }).click();
    await expect(page).toHaveURL(`${URLS.healthy}/`);
    await expect(panel(page, "socials")).toBeVisible();
  });

  test("has no accessibility violations and a visible keyboard focus", async ({ page }) => {
    await page.goto(`${URLS.healthy}/missing`);
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.keyboard.press("Tab");
    const outline = await page.getByRole("link", { name: "back to the dashboard" }).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});

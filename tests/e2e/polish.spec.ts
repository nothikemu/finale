import { expect, test } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard, panel, presenceFixture, settle } from "./helpers";

/** Rough edges a public visitor would notice: keyboard, wrapping, layout stability, tiny screens. */

test.describe("keyboard", () => {
  test("the first Tab stop is a skip link that jumps past the listening list", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".panel--listening .track").first().waitFor();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "skip to github activity" });
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0); // visible once focused
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#activity-title$/);
    await expect(page.locator("#activity-title")).toBeInViewport();
    // focus continues from the calendar, not from the top of the page
    await page.keyboard.press("Tab");
    const inActivity = await page.evaluate(() => !!document.activeElement?.closest(".panel--activity, .panel--projects"));
    expect(inActivity).toBe(true);
  });

  test("the skip link is out of sight until it is focused", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByRole("link", { name: "skip to github activity" });
    expect((await skip.boundingBox())!.y + (await skip.boundingBox())!.height).toBeLessThanOrEqual(0);
  });

  test("Escape closes a calendar tooltip opened by hover", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".calendar__svg rect").nth(120).hover();
    const tip = page.locator(".tooltip");
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("link hit areas reach at least 24px, without changing how the links look", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".panel--listening .track").first().waitFor();
    await page.locator(".panel--projects .project").first().waitFor();
    for (const selector of [".panel--listening .track__title a", ".panel--projects .project__name", ".panel--discord .activity__title a"]) {
      // the link itself is one line of text; the layer around it makes the target reach 24px
      const reach = await page.locator(selector).first().evaluate((link) => {
        const box = link.getBoundingClientRect();
        const after = getComputedStyle(link, "::after");
        return { text: box.height, extra: Math.abs(parseFloat(after.top)) + Math.abs(parseFloat(after.bottom)), content: after.content };
      });
      expect(reach.content, selector).not.toBe("none");
      expect(reach.text + reach.extra, selector).toBeGreaterThanOrEqual(24);
    }
  });

  test("pressing just above a link's text still follows the link", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".panel--projects .project").first().waitFor();
    const hit = await page.locator(".panel--projects .project__name").first().evaluate((link) => {
      const box = link.getBoundingClientRect();
      const element = document.elementFromPoint(box.left + box.width / 2, box.top - 3);
      return element === link || link.contains(element);
    });
    expect(hit).toBe(true);
  });

  test("lists keep their list semantics under list-style: none", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".panel--listening .track").first().waitFor();
    for (const selector of ["ol.tracks", "ul.projects", "ul.links", "ul.badges"]) {
      await expect(page.locator(selector).first(), selector).toHaveAttribute("role", "list");
    }
  });
});

test.describe("link arrows", () => {
  for (const width of [1280, 1024, 390]) {
    test(`are never left alone on a line of their own at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockLanyard(page);
      await page.goto("/");
      await page.locator(".panel--listening .track").first().waitFor();
      await settle(page);
      const stranded = await page.locator(".track__title a").evaluateAll((links) =>
        links.filter((link) => {
          const arrow = link.querySelector(".track__external")!.getBoundingClientRect();
          const tail = link.querySelector(".nowrap")!;
          const text = document.createRange();
          text.setStart(tail.firstChild!, 0);
          text.setEnd(tail.firstChild!, (tail.firstChild as Text).length);
          // the arrow shares a line with the last word of the title when their tops are close
          return Math.abs(arrow.top - text.getBoundingClientRect().top) > 8;
        }).length,
      );
      expect(stranded).toBe(0);
    });
  }
});

test.describe("layout stability", () => {
  test("on a phone the Discord panel keeps one height whatever the card holds", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let answer: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    await page.route("https://api.lanyard.rest/v1/users/*", async (route) => {
      await gate;
      await route.fulfill({ json: { success: true, data: presenceFixture() } }); // the richest card: bio, custom status, two activities
    });
    await page.routeWebSocket("wss://api.lanyard.rest/socket", () => undefined);
    await page.goto("/");
    await settle(page);
    const before = { discord: (await panel(page, "discord").boundingBox())!.height, socials: (await panel(page, "socials").boundingBox())!.y };
    answer?.();
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    await page.waitForTimeout(400);
    expect((await panel(page, "discord").boundingBox())!.height).toBe(before.discord);
    expect((await panel(page, "socials").boundingBox())!.y).toBe(before.socials);
    // and the card is complete: it scrolls inside the panel instead of pushing the page
    const scroller = panel(page, "discord").locator(".scroll");
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test("an activity's progress line is in place from the first frame, so nothing below it moves", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    const shifts: number[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __shifts: number[] }).__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) (window as unknown as { __shifts: number[] }).__shifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await expect(panel(page, "discord").locator(".activity__time").first()).toBeVisible();
    await page.waitForTimeout(600);
    const recorded = await page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts);
    shifts.push(...recorded);
    // the presence itself arriving replaces a fixed-size skeleton area; the progress lines must add nothing on top
    expect(shifts.reduce((sum, value) => sum + value, 0)).toBeLessThan(0.02);
  });
});

test.describe("larger text", () => {
  test("at 200% text size the top row grows instead of clipping About and Socials", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await mockLanyard(page);
    await page.goto(URLS.healthy);
    await page.locator(".panel--listening .track").first().waitFor();
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await settle(page);
    for (const id of ["about", "socials"]) {
      const clipped = await panel(page, id).evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(clipped, id).toBeLessThanOrEqual(1);
    }
    await context.close();
  });
});

test.describe("404 page", () => {
  test("has its own title, and the favicon exists", async ({ page, request }) => {
    await page.goto(`${URLS.healthy}/missing`);
    await expect(page).toHaveTitle("not found · nothikemu");
    const icon = await request.get(`${URLS.healthy}/favicon.ico`);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  });
});

test.describe("the live tag tells the truth about the connection", () => {
  test("says 'connecting' while the socket has not answered, not 'stale'", async ({ page }) => {
    await page.route("https://api.lanyard.rest/v1/users/*", (route) => route.fulfill({ json: { success: true, data: presenceFixture() } }));
    await page.routeWebSocket("wss://api.lanyard.rest/socket", () => undefined); // never says hello
    await page.goto("/");
    const tag = panel(page, "discord").locator(".discord__connection");
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    await expect(tag).toHaveText("connecting");
  });

  test("says 'live' once the socket is up", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "discord").locator(".discord__connection")).toHaveText("live");
  });
});

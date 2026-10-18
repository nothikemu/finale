import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockLanyard, panel } from "./helpers";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`axe finds no violations at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".panel--listening .track").first().waitFor();
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    await page.waitForTimeout(500); // let entrance animations finish so contrast is measured on final colours
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

test("semantic structure: landmarks, headings, lists, time and anchors", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await page.locator(".panel--listening .track").first().waitFor();
  await page.locator("ul.projects > li").first().waitFor();
  await page.locator(".calendar__svg").waitFor();
  expect(await page.locator("main").count()).toBe(1);
  expect(await page.locator("h1").count()).toBe(1);
  expect(await page.locator("section[aria-labelledby]").count()).toBe(6);
  expect(await page.locator("ol.tracks > li").count()).toBeGreaterThan(10);
  expect(await page.locator("ul.projects > li").count()).toBeGreaterThan(10);
  expect(await page.locator("time[datetime]").count()).toBeGreaterThan(20);
});

test("scroll regions have names, can take focus, and show a square focus outline", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await page.locator(".panel--listening .track").first().waitFor();
  for (const id of ["listening", "projects", "discord"]) {
    const region = panel(page, id).locator(".scroll");
    await expect(region).toHaveAttribute("role", "region");
    await expect(region).toHaveAttribute("aria-label", /.+/);
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    // The bottom of the region fades out, which would fade a ring drawn on it: the ring is drawn on the whole panel.
    const ring = await panel(page, id).evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor }));
    expect(ring).toEqual({ style: "solid", width: "1px", color: "rgb(244, 241, 236)" });
  }
});

test("links have visible square focus and accessible names, including new-tab notice", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  const link = panel(page, "socials").locator("a").first();
  await link.focus();
  expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  const name = await link.evaluate((el) => el.textContent);
  expect(name).toContain("twitter / x");
  expect(name).toContain("opens in a new tab");
});

test("status is never conveyed by colour alone", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await expect(panel(page, "discord").locator(".discord__status")).toContainText("online");
  expect(await panel(page, "discord").locator(".status-marker").first().getAttribute("aria-hidden")).toBe("true");
});

test("decorative effects are hidden from assistive technology and images have alt text", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await page.locator(".panel--listening .track").first().waitFor();
  for (const decoration of await page.locator(".fx__exhaust, .fx__bars, .fx__scan").all()) {
    await expect(decoration).toHaveAttribute("aria-hidden", "true");
  }
  const missingAlt = await page.locator("img:not([alt])").count();
  expect(missingAlt).toBe(0);
  await expect(panel(page, "discord").locator(".discord__avatar img")).toHaveAttribute("alt", "Fixture User profile picture");
});

test("text zoom: 200% larger root font keeps content reachable and the page free of horizontal scroll", async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  await page.locator(".panel--listening .track").first().waitFor();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  // scroll regions still scroll, so nothing is lost to clipping
  const projects = panel(page, "projects").locator(".scroll");
  expect(await projects.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test("browser zoom 200% (narrow CSS viewport) switches to the single column without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await mockLanyard(page);
  await page.goto("/");
  await page.locator(".calendar__svg").waitFor();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

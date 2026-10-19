import { expect, test, type Page } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard } from "./helpers";

/**
 * The site cannot be right-clicked, selected or copied (site.protectContent). That is a deterrent,
 * not security: these tests pin down what a visitor in a normal browser can and cannot do.
 */

async function open(page: Page, path = "/") {
  await mockLanyard(page);
  await page.goto(path);
  // ContentGuard marks <html> once its listeners are attached (after hydration).
  await expect(page.locator("html")).toHaveAttribute("data-guard", "on");
}

/** True when the page called preventDefault on the next event of this type (a listener on window runs last). */
async function recordDefaultPrevented(page: Page, type: string) {
  await page.evaluate((name) => {
    (window as unknown as Record<string, unknown>).__prevented = null;
    window.addEventListener(name, (event) => ((window as unknown as Record<string, unknown>).__prevented = event.defaultPrevented), { once: true });
  }, type);
}
const prevented = (page: Page) => page.evaluate(() => (window as unknown as Record<string, unknown>).__prevented);

test.describe("copy protection", () => {
  test("nothing on the page is selectable", async ({ page }) => {
    await open(page);
    const styles = await page.evaluate(() => {
      const pick = (el: Element) => getComputedStyle(el).userSelect;
      return { root: pick(document.documentElement), body: pick(document.body), title: pick(document.querySelector(".panel__title")!), link: pick(document.querySelector("a[href]")!) };
    });
    expect(styles).toEqual({ root: "none", body: "none", title: "none", link: "none" });
  });

  test("select all, double click and triple click select nothing", async ({ page }) => {
    await open(page);
    await page.locator(".panel__title").first().click();
    await page.keyboard.press("Control+a");
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
    const title = page.locator(".panel__title").first();
    await title.dblclick();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
    await title.click({ clickCount: 3 });
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
    // dragging across several panels
    const box = (await page.locator("main").boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
  });

  test("copying leaves the clipboard untouched", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));
    await page.locator(".panel__title").first().click();
    await recordDefaultPrevented(page, "copy");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("sentinel-before");
    // and cutting
    await page.keyboard.press("Control+x");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("sentinel-before");
  });

  test("copy and cut events are cancelled even when something is selected programmatically", async ({ page }) => {
    await open(page);
    for (const type of ["copy", "cut"]) {
      const cancelled = await page.evaluate((name) => {
        const event = new ClipboardEvent(name, { bubbles: true, cancelable: true });
        document.querySelector(".panel__title")!.dispatchEvent(event);
        return event.defaultPrevented;
      }, type);
      expect(cancelled, type).toBe(true);
    }
  });

  test("right-click does nothing on text, links, the avatar and empty space", async ({ page }) => {
    await open(page);
    const targets = [page.locator(".panel__title").first(), page.locator("a[href]").first(), page.locator("img").first(), page.locator("main")];
    for (const target of targets) {
      await target.waitFor();
      await recordDefaultPrevented(page, "contextmenu");
      const box = (await target.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 12), { button: "right" });
      expect(await prevented(page), String(target)).toBe(true);
    }
  });

  test("dragging a link or image out of the page is cancelled", async ({ page }) => {
    await open(page);
    for (const selector of ["a[href]", "img"]) {
      const cancelled = await page.evaluate((sel) => {
        const event = new Event("dragstart", { bubbles: true, cancelable: true });
        document.querySelector(sel)!.dispatchEvent(event);
        return event.defaultPrevented;
      }, selector);
      expect(cancelled, selector).toBe(true);
    }
  });

  test("links, keyboard focus and the calendar tooltip still work", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "skip to github activity" })).toBeFocused();
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".calendar__svg rect").nth(120).hover();
    await expect(page.locator(".tooltip")).toBeVisible();
    const hrefs = await page.locator("a[href^='https://']").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(2);
  });

  test("the error pages are protected too", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response!.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("data-guard", "on");
    expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe("none");
  });

  test("the owner's /status report stays copyable (it is plain text, not a page)", async ({ page }) => {
    await page.goto(`${URLS.unconfiguredDiagnostics}/status`);
    await page.keyboard.press("Control+a");
    expect((await page.evaluate(() => getSelection()!.toString())).length).toBeGreaterThan(100);
  });
});

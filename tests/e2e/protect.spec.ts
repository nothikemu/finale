import { expect, test, type Page } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard } from "./helpers";

/**
 * The site cannot be right-clicked, selected or copied (site.protectContent). That is a deterrent,
 * not security: these tests pin down what a visitor in a normal browser can and cannot do.
 * Two layers do the work (CSS in base.css, events in ContentGuard.tsx); several tests switch the CSS
 * layer off so the script layer is exercised on its own.
 */

/** Turns the user-select rule off, so only ContentGuard stands between the visitor and the text. */
const WITHOUT_CSS_LAYER = ":root[data-protect], :root[data-protect] * { -webkit-user-select: auto !important; user-select: auto !important; }";

async function open(page: Page, path = "/") {
  await mockLanyard(page);
  await page.goto(path);
  // ContentGuard marks <html> once its listeners are attached (after hydration).
  await expect(page.locator("html")).toHaveAttribute("data-guard", "on");
}

/** Arms a one-time listener on window (it runs after ContentGuard's) that records whether the next event of this type was cancelled. */
async function recordDefaultPrevented(page: Page, type: string) {
  await page.evaluate((name) => {
    (window as unknown as Record<string, unknown>).__prevented = null;
    window.addEventListener(name, (event) => ((window as unknown as Record<string, unknown>).__prevented = event.defaultPrevented), { once: true });
  }, type);
}
const prevented = (page: Page) => page.evaluate(() => (window as unknown as Record<string, unknown>).__prevented);

/** Dispatches a cancelable event on the element (or its first text node) and returns whether it was cancelled. */
function cancelled(page: Page, selector: string, type: string, onTextNode = false) {
  return page.evaluate(
    ({ selector, type, onTextNode }) => {
      const element = document.querySelector(selector)!;
      const event = type === "copy" || type === "cut" ? new ClipboardEvent(type, { bubbles: true, cancelable: true }) : new Event(type, { bubbles: true, cancelable: true });
      (onTextNode ? element.firstChild! : element).dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, type, onTextNode },
  );
}

test.describe("copy protection", () => {
  test("nothing on the page is selectable", async ({ page }) => {
    await open(page);
    const styles = await page.evaluate(() => {
      const pick = (el: Element) => getComputedStyle(el).userSelect;
      return { root: pick(document.documentElement), body: pick(document.body), title: pick(document.querySelector(".panel__title")!), link: pick(document.querySelector("a[href]")!) };
    });
    expect(styles).toEqual({ root: "none", body: "none", title: "none", link: "none" });
  });

  test("select all, double click, triple click and dragging select nothing", async ({ page }) => {
    await open(page);
    await page.locator(".panel__title").first().click();
    await page.keyboard.press("ControlOrMeta+a");
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

  test("copying and cutting leave the clipboard untouched", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));
    await page.locator(".panel__title").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("sentinel-before");
    await page.keyboard.press("ControlOrMeta+x");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("sentinel-before");
  });

  test("with selecting allowed, the script layer alone still refuses to copy, cut or start a selection", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.addStyleTag({ content: WITHOUT_CSS_LAYER });
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));

    // Proof that the CSS layer is really off: a script can select, so the text is selectable in principle.
    await page.evaluate(() => getSelection()!.selectAllChildren(document.querySelector("main")!));
    expect((await page.evaluate(() => getSelection()!.toString())).length).toBeGreaterThan(50);

    for (const shortcut of ["ControlOrMeta+c", "ControlOrMeta+x", "Control+Insert", "Shift+Delete"]) {
      await page.keyboard.press(shortcut);
      expect(await page.evaluate(() => navigator.clipboard.readText()), shortcut).toBe("sentinel-before");
    }

    // The user starting a selection with the mouse is cancelled, too.
    await page.evaluate(() => getSelection()!.removeAllRanges());
    const title = page.locator(".panel__title").first();
    await title.dblclick();
    await title.click({ clickCount: 3 });
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
  });

  test("copy, cut, selectstart and dragstart events are cancelled, including on a text node", async ({ page }) => {
    await open(page);
    for (const type of ["copy", "cut", "selectstart", "dragstart", "contextmenu"]) {
      expect(await cancelled(page, ".panel__title", type), type).toBe(true);
    }
    // a selection that starts in text (the event target is the text node, not an element)
    expect(await cancelled(page, ".panel__title", "selectstart", true)).toBe(true);
  });

  test("right-click does nothing on text, links, images and empty space", async ({ page }) => {
    await open(page);
    // pointer-events:none on images means a click on one lands on its container: the point is that nothing opens.
    const targets = { text: page.locator(".panel__title").first(), link: page.locator("a[href^='https://']").first(), image: page.locator("img").first(), "empty space": page.locator("main") };
    for (const [name, target] of Object.entries(targets)) {
      await target.waitFor();
      await recordDefaultPrevented(page, "contextmenu");
      const box = (await target.boundingBox())!;
      expect(box.y, `${name} must be on screen`).toBeGreaterThanOrEqual(0);
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 12), { button: "right" });
      expect(await prevented(page), name).toBe(true);
    }
  });

  test("dragging a link or image out of the page is cancelled", async ({ page }) => {
    await open(page);
    for (const selector of ["a[href^='https://']", "img"]) {
      expect(await cancelled(page, selector, "dragstart"), selector).toBe(true);
    }
  });

  test("form fields, if one is ever added, keep working normally", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", `<input id="probe-input" value="typed text"><textarea id="probe-area">more</textarea><div id="probe-edit" contenteditable="true">editable</div><div id="probe-locked" contenteditable="false">locked</div>`);
    });
    for (const id of ["#probe-input", "#probe-area", "#probe-edit"]) {
      expect(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).userSelect, id), id).toBe("text");
      for (const type of ["contextmenu", "copy", "cut", "selectstart", "dragstart"]) {
        expect(await cancelled(page, id, type), `${id} ${type}`).toBe(false);
      }
    }
    expect(await cancelled(page, "#probe-locked", "contextmenu")).toBe(true);
  });

  test("links, keyboard focus and the calendar tooltip still work", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "skip to github activity" })).toBeFocused();
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".calendar__svg rect").nth(120).hover();
    await expect(page.locator(".tooltip")).toBeVisible();
    // an ordinary click still follows a link (they open in a new tab)
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator("a[href^='https://']").first().click()]);
    await popup.close();
  });

  test("images do not take the right-click, so no 'save image' menu can open", async ({ page }) => {
    await open(page);
    await page.locator("img").first().waitFor({ state: "attached" }); // the avatar arrives with the presence data
    const images = await page.evaluate(() => Array.from(document.images, (img) => getComputedStyle(img).pointerEvents));
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((value) => value === "none")).toBe(true);
  });

  test("printing or saving as PDF gives a blank page", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe("none");
    await page.emulateMedia({ media: "print" });
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe("none");
  });

  test("before the scripts have loaded (or when they fail), the CSS layer still protects the page", async ({ page }) => {
    await mockLanyard(page);
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-protect", "on");
    await expect(page.locator("html")).not.toHaveAttribute("data-guard", "on");
    // an image like the cover art the server renders: right-clicks go through it to the container
    const imageIsHit = await page.evaluate(() => {
      const holder = document.querySelector(".panel--listening .panel__body")!;
      holder.insertAdjacentHTML("afterbegin", `<img id="probe-img" alt="" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`);
      const img = document.getElementById("probe-img")!;
      const box = img.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === img;
    });
    expect(imageIsHit).toBe(false);
    await page.locator(".panel__title").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
  });

  test("the error pages are protected too", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response!.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("data-guard", "on");
    expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe("none");
  });

  test("the owner's /status report stays copyable (it is plain text, not a page)", async ({ page }) => {
    await page.goto(`${URLS.unconfiguredDiagnostics}/status`);
    await page.keyboard.press("ControlOrMeta+a");
    expect((await page.evaluate(() => getSelection()!.toString())).length).toBeGreaterThan(100);
  });
});

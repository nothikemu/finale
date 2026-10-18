import { expect, test, type Page } from "@playwright/test";
import { URLS } from "./constants";
import { expireLanyardSettleTimer, mockLanyard, panel, presenceFixture, settle } from "./helpers";

/**
 * "Every UI should be the same": one visual language across panels, breakpoints
 * and states. These guard against drift between the healthy, unconfigured and
 * outage servers, and between panels.
 */

type Ids = "socials" | "listening" | "about" | "activity" | "projects" | "discord";
const FIXED_PANELS: Ids[] = ["socials", "listening", "about", "activity", "projects"];

async function load(page: Page, base: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await mockLanyard(page);
  await page.goto(`${base}/`);
  await page.waitForLoadState("networkidle");
  // wait until nothing is still loading: no skeleton in any panel
  await page.waitForFunction(() => !document.querySelector(".panel .skeleton, .panel .calendar-skeleton"));
  await settle(page);
}

async function footprints(page: Page, ids: Ids[]) {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (await panel(page, id).boundingBox())!.height;
  return out;
}

test.describe("panel footprint is constant across loading, loaded, unconfigured and failed states", () => {
  for (const width of [1440, 1024, 390]) {
    test(`at ${width}px`, async ({ page }) => {
      const ids: Ids[] = width >= 768 ? [...FIXED_PANELS, "discord"] : FIXED_PANELS;
      const seen: Record<string, Record<string, number>> = {};
      for (const [name, base] of Object.entries(URLS)) {
        await load(page, base, width);
        seen[name] = await footprints(page, ids);
      }
      for (const id of ids) {
        const heights = Object.values(seen).map((s) => s[id]!);
        expect(Math.max(...heights) - Math.min(...heights), `${id} heights across states: ${JSON.stringify(seen)}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("the mobile discord panel keeps its 360px minimum while loading, unconfigured and unreachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // loading: Lanyard never answers, so the skeleton stays up
    await page.route("https://api.lanyard.rest/v1/users/*", () => undefined);
    await page.routeWebSocket("wss://api.lanyard.rest/socket", () => undefined);
    await page.goto("/");
    await expect(panel(page, "discord").locator(".skeleton").first()).toBeVisible();
    await settle(page);
    // a fixed footprint on phones: the card scrolls inside it, so nothing below it moves when presence arrives
    expect((await panel(page, "discord").boundingBox())!.height).toBe(460);

    // not configured (server-rendered shell)
    await page.goto(`${URLS.unconfigured}/`);
    await settle(page);
    expect((await panel(page, "discord").boundingBox())!.height).toBeGreaterThanOrEqual(359.5);
  });

  test("the socials panel does not move when the discord panel finishes loading on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let answer: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    await page.route("https://api.lanyard.rest/v1/users/*", async (route) => {
      await gate;
      await route.fulfill({ json: { success: true, data: presenceFixture({ activities: [], spotify: null }) } });
    });
    await page.routeWebSocket("wss://api.lanyard.rest/socket", () => undefined);
    await page.goto("/");
    await settle(page);
    const before = (await panel(page, "socials").boundingBox())!.y;
    answer?.();
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    // a bare presence fits inside the 360px minimum, so nothing below it moves
    expect((await panel(page, "socials").boundingBox())!.y).toBeCloseTo(before, 0);
  });
});

test.describe("shared typography and structure", () => {
  for (const width of [1440, 1024, 390]) {
    test(`heading rows line up in every panel at ${width}px`, async ({ page }) => {
      await load(page, URLS.healthy, width);
      const rows = await page.locator(".dashboard .panel").evaluateAll((panels) =>
        panels.map((p) => {
          const id = [...p.classList].find((c) => c.startsWith("panel--"))!;
          const box = p.getBoundingClientRect();
          const title = p.querySelector(".panel__title, .discord__label")!.getBoundingClientRect();
          const head = p.querySelector(".panel__head");
          return { id, titleTop: title.top - box.top, headHeight: head ? head.getBoundingClientRect().height : null };
        }),
      );
      // discord draws its heading over its banner by design; every other panel shares one header row
      const shared = rows.filter((r) => r.id !== "panel--discord");
      expect(shared.length).toBe(5);
      for (const r of shared) {
        expect(r.titleTop, JSON.stringify(rows)).toBeCloseTo(shared[0]!.titleTop, 0);
        expect(r.headHeight!, JSON.stringify(rows)).toBeCloseTo(shared[0]!.headHeight!, 0);
      }
    });
  }

  test("every panel heading and every body text uses the same type tokens", async ({ page }) => {
    await load(page, URLS.healthy, 1440);
    const styles = await page.locator(".panel__title, .discord__label").evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.textTransform, s.color].join("|");
      }),
    );
    expect(new Set(styles).size, JSON.stringify(styles)).toBe(1);
    const families = await page.locator(".panel *").evaluateAll((els) => [...new Set(els.filter((el) => el.textContent?.trim()).map((el) => getComputedStyle(el).fontFamily))]);
    expect(families).toHaveLength(1);
  });

  test("not-configured, unavailable and empty messages share one look in every panel", async ({ page }) => {
    const mock = await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.clock.install();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${URLS.outage}/`);
    await expireLanyardSettleTimer(page, mock);
    const states = page.locator(".dashboard .state");
    await expect(states).toHaveCount(4); // discord, listening, activity, projects
    const looks = await states.evaluateAll((els) =>
      els.map((el) => {
        const text = getComputedStyle(el.querySelector(".state__text")!);
        const box = getComputedStyle(el);
        return [text.fontFamily, text.fontSize, text.color, text.lineHeight, text.textAlign, box.alignContent].join("|");
      }),
    );
    expect(new Set(looks).size, JSON.stringify(looks)).toBe(1);

    await page.goto(`${URLS.unconfigured}/`);
    const unconfigured = await page.locator(".dashboard .state").evaluateAll((els) => els.map((el) => getComputedStyle(el.querySelector(".state__text")!).fontSize + getComputedStyle(el.querySelector(".state__text")!).color));
    expect(new Set(unconfigured).size).toBe(1);
  });

  test("production never shows setup hints or integration names to visitors", async ({ page }) => {
    // discord unreachable, then discord untracked
    await page.clock.install();
    const mock = await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.goto("/");
    await expireLanyardSettleTimer(page, mock);
    await expect(panel(page, "discord")).toContainText("presence unavailable");
    expect(await panel(page, "discord").locator(".state__hint").count()).toBe(0);
    await expect(panel(page, "discord")).not.toContainText(/lanyard/i);

    const untracked = await page.context().newPage();
    await mockLanyard(untracked, presenceFixture(), { rest: "untracked", socket: "down" });
    await untracked.goto("/");
    await expect(panel(untracked, "discord")).toContainText("presence not tracked");
    expect(await panel(untracked, "discord").locator(".state__hint").count()).toBe(0);

    // every other state message, healthy and unconfigured
    await page.goto(`${URLS.unconfigured}/`);
    await page.waitForFunction(() => !document.querySelector(".panel .skeleton, .panel .calendar-skeleton"));
    expect(await page.locator(".dashboard .state__hint").count()).toBe(0);
    await expect(page.locator(".dashboard")).not.toContainText(/GITHUB_TOKEN|LISTENBRAINZ|DISCORD_USER_ID/);
  });

  test("missing-configuration wording is the same across the credential-dependent panels", async ({ page }) => {
    await load(page, URLS.unconfigured, 1440);
    const texts = await page.locator(".dashboard .state__text").allTextContents();
    expect(texts).toEqual(expect.arrayContaining(["presence not configured", "listening not configured", "github activity not configured"]));
  });

  test("the now-playing card and discord activity cards share their card styling", async ({ page }) => {
    await load(page, URLS.healthy, 1440);
    const pick = (sel: string, props: string[]) => page.locator(sel).first().evaluate((el, ps) => ps.map((p) => getComputedStyle(el).getPropertyValue(p)), props);
    expect(await pick(".now-playing", ["padding-left", "padding-top", "border-top-color", "background-color"])).toEqual(
      await pick(".activity", ["padding-left", "padding-top", "border-top-color", "background-color"]),
    );
    expect(await pick(".now-playing__label", ["color", "font-size", "letter-spacing"])).toEqual(await pick(".activity__kind", ["color", "font-size", "letter-spacing"]));
  });
});

test.describe("focus rings are never clipped", () => {
  async function ringGaps(page: Page, selector: string) {
    await page.locator(selector).first().focus();
    return page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const box = el.getBoundingClientRect();
      let clip: HTMLElement | null = el.parentElement;
      while (clip && getComputedStyle(clip).overflowY === "visible") clip = clip.parentElement;
      const c = clip!.getBoundingClientRect();
      return { reach, left: box.left - reach - c.left, right: c.right - (box.right + reach), top: box.top - reach - c.top };
    });
  }

  for (const width of [1440, 390]) {
    test(`socials, projects, listening and discord links at ${width}px`, async ({ page }) => {
      await load(page, URLS.healthy, width);
      for (const selector of [".panel--socials a", ".panel--projects .project__name", ".panel--listening .track__title a", ".panel--discord .activity__title a"]) {
        const gaps = await ringGaps(page, selector);
        expect(gaps.reach, selector).toBe(3);
        expect(gaps.left, `${selector} left`).toBeGreaterThanOrEqual(0);
        expect(gaps.right, `${selector} right`).toBeGreaterThanOrEqual(0);
        expect(gaps.top, `${selector} top`).toBeGreaterThanOrEqual(0);
      }
    });
  }

  test("the bleed does not change layout: panel bodies still start at the same place", async ({ page }) => {
    await load(page, URLS.healthy, 1440);
    const gaps = await page.locator(".panel--socials").evaluate((el) => {
      const panel = el.getBoundingClientRect();
      const row = el.querySelector(".link-row")!.getBoundingClientRect();
      const head = el.querySelector(".panel__head")!.getBoundingClientRect();
      return { left: row.left - panel.left, headToRow: row.top - head.bottom, right: panel.right - row.right };
    });
    // 1px border + 24px padding on each side, 18px between the heading row and the first link
    expect(gaps.left).toBeCloseTo(25, 0);
    expect(gaps.right).toBeCloseTo(25, 0);
    expect(gaps.headToRow).toBeCloseTo(18, 0);
  });
});

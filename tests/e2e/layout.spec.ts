import { expect, test } from "@playwright/test";
import { mockLanyard, settle } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockLanyard(page);
});

type Page = import("@playwright/test").Page;
const PANEL_IDS = ["discord", "socials", "listening", "about", "activity", "projects"] as const;

async function panelBoxes(page: Page) {
  const entries = await Promise.all(PANEL_IDS.map(async (id) => [id, await box(page, `.panel--${id}`)] as const));
  return Object.fromEntries(entries) as Record<(typeof PANEL_IDS)[number], NonNullable<Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>>>;
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

test.describe("desktop layout at 1440x900", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator(".panel--listening .track").first().waitFor();
    await page.locator(".calendar__svg").waitFor();
    await settle(page);
  });

  test("six panels in the wireframe's hierarchy and reading order", async ({ page }) => {
    const ids = await page.locator(".dashboard .panel").evaluateAll((els) => els.map((el) => [...el.classList].find((c) => c.startsWith("panel--"))));
    expect(ids).toEqual(["panel--discord", "panel--socials", "panel--listening", "panel--about", "panel--activity", "panel--projects"]);
  });

  test("container, margins, gaps and row heights match the spec", async ({ page }) => {
    const dashboard = await box(page, ".dashboard");
    expect(dashboard.width).toBeCloseTo(1376, 1);
    expect(dashboard.x).toBeCloseTo(32, 1);

    const { discord, socials, listening, about, activity, projects } = await panelBoxes(page);
    for (const top of [discord, socials, listening, about]) expect(top.height).toBeCloseTo(390, 1);
    for (const bottom of [activity, projects]) expect(bottom.height).toBeCloseTo(360, 1);

    // 16px gaps in both rows and between them
    expect(socials.x - (discord.x + discord.width)).toBeCloseTo(16, 0);
    expect(listening.x - (socials.x + socials.width)).toBeCloseTo(16, 0);
    expect(about.x - (listening.x + listening.width)).toBeCloseTo(16, 0);
    expect(projects.x - (activity.x + activity.width)).toBeCloseTo(16, 0);
    expect(activity.y - (discord.y + discord.height)).toBeCloseTo(16, 0);

    // reference widths: 382 / 282 / 332 / 332 and 907 / 453
    expect(discord.width).toBeCloseTo(382, 0);
    expect(socials.width).toBeCloseTo(282, 0);
    expect(listening.width).toBeCloseTo(332, 0);
    expect(about.width).toBeCloseTo(332, 0);
    expect(activity.width).toBeCloseTo(907, 0);
    expect(projects.width).toBeCloseTo(453, 0);
    expect(activity.width / projects.width).toBeCloseTo(2, 1);
  });

  test("panel padding, hairline border and OLED background", async ({ page }) => {
    const style = await page.locator(".panel--socials").evaluate((el) => {
      const s = getComputedStyle(el);
      return { padding: s.paddingLeft, border: s.borderTopWidth, shadow: s.boxShadow, htmlBg: getComputedStyle(document.documentElement).backgroundColor };
    });
    expect(style.padding).toBe("24px");
    expect(style.border).toBe("1px");
    expect(style.shadow).toContain("inset");
    expect(style.htmlBg).toBe("rgb(0, 0, 0)");
  });

  test("the composition is vertically centred when the viewport is taller than the content", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1300 });
    const top = (await box(page, ".panel--discord")).y;
    await settle(page);
    const bottom = 1300 - ((await box(page, ".panel--projects")).y + 360);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(2);
  });

  test("short viewports scroll instead of clipping", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    const overflowY = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(overflowY).toBe(true);
    const projects = await box(page, ".panel--projects");
    expect(projects.height).toBeCloseTo(360, 1);
  });
});

test.describe("responsive behaviour", () => {
  const widths = [1920, 1440, 1280, 1200, 1199, 1024, 900, 768, 767, 600, 414, 390, 360, 320];

  for (const width of widths) {
    test(`no horizontal page scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.locator(".calendar__svg").waitFor();
      await page.locator(".panel--listening .track").first().waitFor();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      // nothing inside a panel pokes out of it, either
      const escaped = await page.locator(".dashboard .panel").evaluateAll((panels) =>
        panels.flatMap((panel) => {
          const p = panel.getBoundingClientRect();
          return [...panel.querySelectorAll("*")]
            .filter((el) => !el.closest(".calendar__scroll, .scroll, .visually-hidden"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1);
            })
            .map((el) => `${el.tagName}.${el.className}`);
        }),
      );
      expect(escaped).toEqual([]);
    });
  }

  const columns = async (page: import("@playwright/test").Page, selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);

  test("four-up at 1200, two-up at 1199 and 768, single column at 767", async ({ page }) => {
    for (const [width, top, bottom] of [
      [1200, 4, 2],
      [1199, 2, 1],
      [768, 2, 1],
      [767, 1, 1],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      expect(await columns(page, ".row--top")).toBe(top);
      expect(await columns(page, ".row--bottom")).toBe(bottom);
    }
  });

  test("two-column order is discord, socials, listening, about; calendar then projects full width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/");
    await settle(page);
    const { discord, socials, listening, about, activity, projects } = await panelBoxes(page);
    expect(socials.x).toBeGreaterThan(discord.x);
    expect(socials.y).toBeCloseTo(discord.y, 1);
    expect(listening.y).toBeGreaterThan(discord.y);
    expect(about.x).toBeGreaterThan(listening.x);
    expect(about.y).toBeCloseTo(listening.y, 1);
    expect(activity.width).toBeCloseTo(projects.width, 0);
    expect(projects.y).toBeGreaterThan(activity.y);
    expect(discord.height).toBeGreaterThanOrEqual(340);
    expect(discord.height).toBeLessThanOrEqual(390);
  });

  test("mobile: 16px padding, 12px gaps, fixed heights for scroll panels, single reading order", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await settle(page);
    const dashboard = await box(page, ".dashboard");
    expect(dashboard.x).toBeCloseTo(16, 1);
    expect(dashboard.width).toBeCloseTo(358, 1);
    const discord = await box(page, ".panel--discord");
    const socials = await box(page, ".panel--socials");
    expect(socials.y - (discord.y + discord.height)).toBeCloseTo(12, 0);
    expect(discord.height).toBeGreaterThanOrEqual(360);
    expect((await box(page, ".panel--listening")).height).toBeCloseTo(380, 1);
    expect((await box(page, ".panel--projects")).height).toBeCloseTo(420, 1);
    const padding = await page.locator(".panel--socials").evaluate((el) => getComputedStyle(el).paddingLeft);
    expect(padding).toBe("18px");
  });
});

test.describe("square-edged material", () => {
  test("no element or pseudo-element has a border radius", async ({ page }) => {
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    await page.locator(".panel--listening .track").first().waitFor();
    const rounded = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const el of document.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"] as const) {
          const radius = getComputedStyle(el, pseudo).borderRadius;
          if (radius && !/^0(px)?( 0(px)?)*$/.test(radius)) offenders.push(`${el.tagName}${pseudo ?? ""}: ${radius}`);
        }
      }
      return offenders;
    });
    expect(rounded).toEqual([]);
  });

  test("palette stays black, gray and quartz white (no coloured chrome)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    const coloured = await page.evaluate(() => {
      const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? null;
      const offenders = new Set<string>();
      for (const el of document.querySelectorAll(".panel, .panel *")) {
        const s = getComputedStyle(el);
        for (const [prop, value] of [["color", s.color], ["background", s.backgroundColor], ["border", s.borderTopColor], ["fill", s.fill]] as const) {
          const rgb = value.startsWith("rgb") ? parse(value) : null;
          if (!rgb) continue;
          const [r, g, b] = rgb as [number, number, number];
          // quartz is warm (#f4f1ec), so allow a small channel spread
          if (Math.max(r, g, b) - Math.min(r, g, b) > 14) offenders.add(`${el.className} ${prop}: ${value}`);
        }
      }
      return [...offenders];
    });
    expect(coloured).toEqual([]);
  });
});

test("JetBrainsMono Nerd Font Mono is actually loaded and used", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("response", (r) => r.url().endsWith(".woff2") && fontRequests.push(`${r.status()} ${r.url().split("/").pop()}`));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family}:${f.weight}`));
  expect(loaded).toContain("JetBrainsMono Nerd Font Mono:400");
  expect(loaded).toContain("JetBrainsMono Nerd Font Mono:500");
  expect(fontRequests).toEqual(expect.arrayContaining(["200 JetBrainsMonoNerdFontMono-Regular.woff2", "200 JetBrainsMonoNerdFontMono-Medium.woff2"]));
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family.startsWith('"JetBrainsMono Nerd Font Mono"')).toBe(true);
});

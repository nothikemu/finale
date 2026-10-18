import { expect, test } from "@playwright/test";
import { mockLanyard, panel } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockLanyard(page);
  await page.goto("/");
  await page.locator(".panel--listening .track").first().waitFor();
  await page.locator(".calendar__svg").waitFor();
  // Projects stream in on their own after two paginated GitHub calls; reads below are one-shot.
  await page.locator(".panel--projects .project").first().waitFor();
});

test("panel headings", async ({ page }) => {
  const headings = await page.locator(".dashboard h2").allTextContents();
  expect(headings).toEqual(["discord", "socials", "recently played", "about", "github activity", "projects"]);
  await expect(panel(page, "listening").locator(".panel__aside")).toHaveText("via listenbrainz");
  await expect(page.locator("h1")).toHaveText("nothikemu personal dashboard");
});

test.describe("socials", () => {
  test("exact destinations, labels and handles, opened safely in a new tab", async ({ page }) => {
    const rows = await panel(page, "socials").locator("a").evaluateAll((links) =>
      links.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        label: a.querySelector(".link-row__label")?.textContent,
        handle: a.querySelector(".link-row__handle")?.textContent,
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      })),
    );
    expect(rows.map(({ href, label, handle }) => ({ href, label, handle }))).toEqual([
      { href: "https://twitter.com/nothikemu", label: "twitter / x", handle: "@nothikemu" },
      { href: "https://github.com/nothikemu", label: "github", handle: "@nothikemu" },
      { href: "https://guns.lol/hkmu", label: "guns.lol", handle: "/hkmu" },
    ]);
    for (const row of rows) {
      expect(row.target).toBe("_blank");
      expect(row.rel).toContain("noopener");
      expect(row.rel).toContain("noreferrer");
    }
  });

  test("rows are at least 44px tall touch targets", async ({ page }) => {
    for (const box of await panel(page, "socials").locator("a").evaluateAll((links) => links.map((a) => a.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });

  test("hover reveals an underline and nudges the icon at most 2px", async ({ page }) => {
    const link = panel(page, "socials").locator("a").first();
    await link.hover();
    await page.waitForTimeout(300);
    const state = await link.evaluate((a) => ({
      icon: getComputedStyle(a.querySelector(".link-row__icon")!).transform,
      underline: getComputedStyle(a.querySelector(".link-row__handle")!).backgroundSize,
    }));
    expect(state.icon).toBe("matrix(1, 0, 0, 1, 2, 0)");
    expect(state.underline).toContain("100%");
  });
});

test("about copy is preserved exactly, lowercase, in separate blocks", async ({ page }) => {
  const lines = await panel(page, "about").locator(".about__line").evaluateAll((els) => els.map((el) => el.textContent));
  expect(lines).toEqual([
    "mechanical engineering student",
    "avid model rocket maker",
    "i make beats in my free time",
    "thorough enjoyer of fiddling with computers",
  ]);
  const gaps = await panel(page, "about").locator(".about__line").evaluateAll((els) => els.slice(1).map((el, i) => el.getBoundingClientRect().top - els[i]!.getBoundingClientRect().bottom));
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(18);
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(22);
});

test.describe("recently played", () => {
  test("renders newest first with art placeholders, links only when verified, and times", async ({ page }) => {
    const rows = panel(page, "listening").locator(".tracks .track");
    expect(await rows.count()).toBe(50);
    const times = await rows.locator("time").evaluateAll((els) => els.map((el) => Date.parse((el as HTMLTimeElement).dateTime)));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Fixture rows 0, 4, 8... carry no Spotify id, so they must not be linked.
    expect(await rows.nth(0).locator("a").count()).toBe(0);
    expect(await rows.nth(1).locator("a").count()).toBe(1);
    const href = await rows.nth(1).locator("a").getAttribute("href");
    expect(href).toBe("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    // album art is square
    const art = await rows.nth(0).locator(".art").boundingBox();
    expect(art?.width).toBe(art?.height);
    expect(art?.width).toBeGreaterThanOrEqual(40);
    expect(art?.width).toBeLessThanOrEqual(44);
  });

  test("shows now playing separately, without invented progress", async ({ page }) => {
    const now = panel(page, "listening").locator(".now-playing");
    await expect(now).toContainText("now playing");
    await expect(now).toContainText("Now Playing Fixture");
    await expect(now.locator(".progress, progress, [role=progressbar]")).toHaveCount(0);
  });

  test("scrolls vertically with a hidden scrollbar and no extra controls", async ({ page }) => {
    const body = panel(page, "listening").locator(".scroll");
    const m = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      gutter: (el as HTMLElement).offsetWidth - el.clientWidth - 0,
      scrollbarWidth: getComputedStyle(el).scrollbarWidth,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight * 2);
    expect(m.scrollbarWidth).toBe("none");
    expect(m.overflowY).toBe("auto");
    expect(m.gutter).toBe(0);
    await expect(panel(page, "listening").locator("input, [type=search], button, [role=search]")).toHaveCount(0);
    // heading stays outside the scrolling body
    expect(await body.locator("h2").count()).toBe(0);
    await body.evaluate((el) => (el.scrollTop = 600));
    await expect(panel(page, "listening").locator("h2")).toBeInViewport();
  });

  test("scroll region is named and keyboard focusable, and page scrolling is not hijacked", async ({ page }) => {
    const body = panel(page, "listening").locator(".scroll");
    await expect(body).toHaveAttribute("aria-label", /scrollable/);
    await body.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0); // keyboard scrolling is smoothed
    // a wheel gesture at the end of the list chains to the page (no scroll trap)
    expect(await body.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe("auto");
  });

  test("timestamps are semantic and carry the exact time", async ({ page }) => {
    const first = panel(page, "listening").locator(".tracks time").first();
    await expect(first).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    expect(await first.getAttribute("title")).toMatch(/\d{4}/);
    await expect(first.locator(".visually-hidden")).not.toBeEmpty();
  });
});

test.describe("projects", () => {
  test("every public repository is reachable by scrolling (pagination followed)", async ({ page }) => {
    const names = await panel(page, "projects").locator(".project__name").evaluateAll((els) => els.map((el) => el.textContent?.replace(/\s*\(opens.*$/, "").trim()));
    expect(names).toHaveLength(40); // fixture serves 25 + 15 across two Link-paginated pages
    expect(new Set(names).size).toBe(40);
    const body = panel(page, "projects").locator(".scroll");
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(panel(page, "projects").locator(".project").last()).toBeInViewport();
  });

  test("sorted most recently updated first, with discreet fork and archived labels and correct URLs", async ({ page }) => {
    const rows = await panel(page, "projects").locator(".project").evaluateAll((els) =>
      els.map((el) => ({
        updated: Date.parse(el.querySelector("time")!.dateTime),
        href: (el.querySelector("a") as HTMLAnchorElement).href,
        tags: [...el.querySelectorAll(".tag")].map((t) => t.textContent),
      })),
    );
    expect([...rows].map((r) => r.updated).sort((a, b) => b - a)).toEqual(rows.map((r) => r.updated));
    expect(rows[0]!.href).toBe("https://github.com/nothikemu/rocket-sim");
    expect(rows.flatMap((r) => r.tags).sort()).toEqual(["archived", "fork"]);
  });

  test("descriptions wrap instead of truncating, and there are no search/filter/view-more controls", async ({ page }) => {
    const first = panel(page, "projects").locator(".project__description").first();
    expect(await first.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(40);
    expect(await first.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("clip");
    await expect(panel(page, "projects").locator("input, button, [role=search], [role=combobox]")).toHaveCount(0);
    await expect(panel(page, "projects").getByText(/view more|load more|show all/i)).toHaveCount(0);
  });

  test("language, stars, forks and updated date appear as restrained metadata", async ({ page }) => {
    const meta = panel(page, "projects").locator(".project__meta").first();
    await expect(meta).toContainText("typescript");
    await expect(meta.locator("time")).toHaveText(/[a-z]{3} \d{1,2}, \d{4}/);
  });
});

test.describe("github activity", () => {
  test("a real calendar: every day a square cell with an accessible date and count, totals consistent", async ({ page }) => {
    const data = await page.locator(".calendar__svg rect").evaluateAll((cells) =>
      cells.map((c) => ({
        label: c.getAttribute("aria-label")!,
        w: Number(c.getAttribute("width")),
        h: Number(c.getAttribute("height")),
        cls: c.getAttribute("class")!,
      })),
    );
    expect(data.length).toBeGreaterThan(350);
    expect(data.length).toBeLessThanOrEqual(371);
    for (const cell of data) {
      expect(cell.w).toBe(cell.h);
      expect(cell.label).toMatch(/^(no contributions|\d[\d,]* contributions?) on [a-z]{3}, [a-z]{3} \d{1,2}, \d{4}$/);
    }
    const sum = data.reduce((total, cell) => total + (cell.label.startsWith("no") ? 0 : Number(cell.label.split(" ")[0]!.replace(/,/g, ""))), 0);
    const shown = await page.locator(".calendar__number").textContent();
    expect(Number(shown!.replace(/,/g, ""))).toBe(sum);
    await expect(page.locator(".calendar__total")).toContainText("contributions");
    await expect(page.locator(".calendar__total")).not.toContainText("commit");
    // levels use the full monochrome ramp
    expect(new Set(data.map((c) => c.cls)).size).toBe(5);
  });

  test("labels, legend and period are present", async ({ page }) => {
    const months = await page.locator(".calendar__months span").allTextContents();
    expect(months.length).toBeGreaterThanOrEqual(10);
    for (const month of months) expect(month).toMatch(/^[a-z]{3}$/);
    expect(await page.locator(".calendar__weekdays span").allTextContents()).toEqual(["mon", "wed", "fri"]);
    expect(await page.locator(".calendar__legend .legend-cell").count()).toBe(5);
    await expect(page.locator(".calendar__legend")).toContainText("less");
    await expect(page.locator(".calendar__legend")).toContainText("more");
    const range = page.locator(".calendar__range time");
    await expect(range).toHaveCount(2);
    expect(Date.parse((await range.nth(1).getAttribute("datetime"))!) - Date.parse((await range.nth(0).getAttribute("datetime"))!)).toBeGreaterThan(360 * 86_400_000);
  });

  test("at desktop width the whole calendar fits: nothing cropped, no scrolling needed", async ({ page }) => {
    const m = await page.locator(".calendar__scroll").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    const scroller = await page.locator(".calendar__scroll").boundingBox();
    const cells = await page.locator(".calendar__svg rect").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.right]));
    expect(Math.min(...cells.map((c) => c[0]!))).toBeGreaterThanOrEqual(scroller!.x);
    expect(Math.max(...cells.map((c) => c[1]!))).toBeLessThanOrEqual(scroller!.x + scroller!.width);
    // cells are about 11-12px with ~3px gaps
    const cell = await page.locator(".calendar__svg rect").first().boundingBox();
    expect(cell!.width).toBeGreaterThanOrEqual(10.5);
    expect(cell!.width).toBeLessThanOrEqual(12.6);
    // first and last month labels are not cut off by the panel
    const panelBox = await panel(page, "activity").boundingBox();
    const labels = await page.locator(".calendar__months span").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.right]));
    expect(Math.min(...labels.map((l) => l[0]!))).toBeGreaterThan(panelBox!.x);
    expect(Math.max(...labels.map((l) => l[1]!))).toBeLessThan(panelBox!.x + panelBox!.width);
  });

  test("mobile keeps a readable intrinsic width, scrolls inside the panel, opens on the latest week and keeps every date reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    const m = await page.locator(".calendar__scroll").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX }));
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
    expect(m.overflowX).toBe("auto"); // never "hidden"
    const cell = await page.locator(".calendar__svg rect").first().boundingBox();
    expect(cell!.width).toBeGreaterThanOrEqual(9.5);

    await panel(page, "activity").scrollIntoViewIfNeeded();
    // the most recent day is visible without any horizontal scrolling
    const latest = page.locator('.calendar__svg rect[tabindex="0"]');
    await expect(latest).toBeInViewport();
    // and the oldest day is reachable by scrolling
    await page.locator(".calendar__scroll").evaluate((el) => el.scrollTo({ left: -el.scrollWidth }));
    await expect(page.locator(".calendar__svg rect").first()).toBeInViewport();
  });

  test("the SVG exposes a textual summary and a grid for assistive technology", async ({ page }) => {
    await expect(page.locator(".calendar__svg")).toHaveAttribute("role", "grid");
    await expect(page.locator(".calendar__svg")).toHaveAttribute("aria-label", /contributions/);
    expect(await page.locator(".calendar > p.visually-hidden").textContent()).toMatch(/contributions from .* to .*days with activity/);
    expect(await page.locator('.calendar__svg [role="row"]').count()).toBe(7);
  });
});

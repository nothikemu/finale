import { expect, test } from "@playwright/test";
import { expireLanyardSettleTimer, mockLanyard, panel, presenceFixture, settle, waitForSubscription } from "./helpers";

test.describe("calendar interaction", () => {
  test.beforeEach(async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
  });

  test("hovering a cell shows its date and count in a square tooltip", async ({ page }) => {
    const cell = page.locator(".calendar__svg rect").nth(120);
    const label = await cell.getAttribute("aria-label");
    await cell.hover();
    const tip = page.locator(".tooltip");
    await expect(tip).toHaveText(label!);
    const radius = await tip.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe("0px");
    // positioned against the viewport, directly above the hovered cell
    const [t, c] = [await tip.boundingBox(), await cell.boundingBox()];
    expect(t!.y + t!.height).toBeLessThanOrEqual(c!.y);
    expect(Math.abs(t!.x + t!.width / 2 - (c!.x + c!.width / 2))).toBeLessThan(3);
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);
  });

  test("keyboard: one tab stop, arrow keys move between days, focus shows the same details", async ({ page }) => {
    const stops = await page.locator('.calendar__svg rect[tabindex="0"]').count();
    expect(stops).toBe(1);
    await page.locator('.calendar__svg rect[tabindex="0"]').focus();
    const start = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await expect(page.locator(".tooltip")).toHaveText(start!);

    await page.keyboard.press("ArrowLeft");
    const previousWeek = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(previousWeek).not.toBe(start);
    await expect(page.locator(".tooltip")).toHaveText(previousWeek!);
    // moving left one week keeps the weekday
    expect(previousWeek!.split(" on ")[1]!.slice(0, 3)).toBe(start!.split(" on ")[1]!.slice(0, 3));

    // the latest day is a Sunday (top row), so moving up is a no-op and moving down is the next weekday
    await page.keyboard.press("ArrowUp");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(previousWeek);
    await page.keyboard.press("ArrowDown");
    const nextDay = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(nextDay).not.toBe(previousWeek);
    expect(nextDay!.split(" on ")[1]!.slice(0, 3)).toBe("mon");

    await page.keyboard.press("Home");
    const home = await page.evaluate(() => document.activeElement?.getAttribute("data-col"));
    expect(home).toBe("0");
    // roving tabindex: still exactly one tab stop, and it moved with focus
    expect(await page.locator('.calendar__svg rect[tabindex="0"]').count()).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("tabindex"))).toBe("0");

    await page.keyboard.press("Escape");
    await expect(page.locator(".tooltip")).toHaveCount(0);
  });

  test("the tooltip does not auto-steal focus or change while data refreshes", async ({ page }) => {
    await page.locator(".calendar__svg rect").nth(10).hover();
    const before = await page.locator(".tooltip").textContent();
    await page.waitForTimeout(500);
    expect(await page.locator(".tooltip").textContent()).toBe(before);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});

test.describe("calendar interaction on touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("tapping a cell shows details; tapping again or elsewhere dismisses them", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".calendar__svg").waitFor();
    const cell = page.locator('.calendar__svg rect[tabindex="0"]');
    await cell.tap();
    await expect(page.locator(".tooltip")).toHaveText((await cell.getAttribute("aria-label"))!);
    await cell.tap();
    await expect(page.locator(".tooltip")).toHaveCount(0);
    await cell.tap();
    await expect(page.locator(".tooltip")).toBeVisible();
    await panel(page, "socials").locator(".panel__title").tap();
    await expect(page.locator(".tooltip")).toHaveCount(0);
  });
});

test.describe("about word effects", () => {
  test.beforeEach(async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await settle(page);
  });

  const effects = [
    { word: "rocket", selector: ".fx--rocket", animated: ".fx--rocket", child: ".fx__exhaust i" },
    { word: "beats", selector: ".fx--beats", animated: ".fx--beats .fx__bars i", child: null },
    { word: "enjoyer", selector: ".fx--enjoyer", animated: ".fx--enjoyer", child: ".fx__scan" },
  ];

  test("each effect is limited to its word, keeps the readable text, and has a distinct, aria-hidden decoration", async ({ page }) => {
    for (const fx of effects) {
      const el = page.locator(fx.selector);
      await expect(el).toHaveCount(1);
      expect(await el.evaluate((node) => node.textContent)).toBe(fx.word);
      expect(await el.locator("[aria-hidden='true']").count()).toBe(1);
      expect(await el.getAttribute("role")).toBeNull();
      expect(await el.getAttribute("tabindex")).toBeNull(); // plain text, no fake button semantics
    }
    expect(await page.locator(".fx").count()).toBe(3);
  });

  test("the effects play on hover and use transform/opacity only (no layout shift)", async ({ page }) => {
    for (const fx of effects) {
      const word = page.locator(fx.selector);
      const aboutBefore = await panel(page, "about").locator(".about").boundingBox();
      const wordBefore = await word.boundingBox();
      await word.hover();
      await page.waitForTimeout(120);
      const running = await page.locator(fx.animated).first().evaluate((el) => getComputedStyle(el).animationName);
      expect(running, `${fx.word} should be animating while hovered`).not.toBe("none");
      const aboutDuring = await panel(page, "about").locator(".about").boundingBox();
      expect(aboutDuring).toEqual(aboutBefore);
      const wordDuring = await word.boundingBox();
      expect(Math.abs(wordDuring!.x - wordBefore!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(wordDuring!.width - wordBefore!.width)).toBeLessThanOrEqual(1);
      await page.mouse.move(5, 5);
    }
  });

  test("rocket lifts by 2-3px and the animation is brief (450-650ms)", async ({ page }) => {
    const word = page.locator(".fx--rocket");
    await word.hover();
    const info = await word.evaluate((el) => {
      const animation = el.getAnimations()[0] as CSSAnimation | undefined;
      return { duration: animation?.effect?.getTiming().duration, name: animation?.animationName };
    });
    expect(info.name).toBe("rocket-lift");
    expect(Number(info.duration)).toBeGreaterThanOrEqual(450);
    expect(Number(info.duration)).toBeLessThanOrEqual(650);
    let maxLift = 0;
    for (let i = 0; i < 12; i += 1) {
      const lift = await word.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
      maxLift = Math.min(maxLift, lift);
      await page.waitForTimeout(50);
    }
    expect(maxLift).toBeLessThanOrEqual(-2);
    expect(maxLift).toBeGreaterThanOrEqual(-3);
  });

  test("beats shows square-ended bars and makes no audio or reactivity claim", async ({ page }) => {
    expect(await page.locator(".fx--beats .fx__bars i").count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator("audio, video, canvas").count()).toBe(0);
    const style = await page.locator(".fx--beats .fx__bars i").first().evaluate((el) => ({ w: getComputedStyle(el).width, r: getComputedStyle(el).borderRadius }));
    expect(style).toEqual({ w: "2px", r: "0px" });
  });

  test("taps play the effect on touch devices", async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await mockLanyard(page);
    await page.goto("/");
    await page.locator(".fx--rocket").tap();
    await expect(page.locator(".fx--rocket")).toHaveAttribute("data-playing", "");
    expect(await page.locator(".fx--rocket").evaluate((el) => getComputedStyle(el).animationName)).toBe("rocket-lift");
    await expect(page.locator(".fx--rocket")).not.toHaveAttribute("data-playing", "", { timeout: 2000 });
    await context.close();
  });

  test("reduced motion keeps the static special styling and runs no animation", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await mockLanyard(page);
    await page.goto("/");
    for (const fx of effects) {
      await page.locator(fx.selector).hover();
      await page.waitForTimeout(100);
      const names = await page.locator(`${fx.selector}, ${fx.selector} *`).evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
      expect(names.every((n) => n === "none")).toBe(true);
    }
    // the static decoration is still rendered and visible
    const opacity = await page.locator(".fx__exhaust i").first().evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeGreaterThan(0.2);
    expect(await page.locator(".fx__bars i").first().evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
    // and panels do not run their entrance animation either
    const panelAnimation = await page.locator(".panel--about").evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(panelAnimation)).toBeLessThan(0.01);
    await context.close();
  });
});

test.describe("glass material", () => {
  test("uses one backdrop blur per panel where supported, and no nested blur", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    // Measure a settled page: the Discord panel swaps its skeleton for the live presence once it hydrates, and
    // a node removed between the query and the style read reports an empty style, which is not a blur.
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    const blurred = await page.locator(".dashboard .panel").evaluateAll((els) => els.map((el) => getComputedStyle(el).backdropFilter));
    for (const filter of blurred) expect(filter).toMatch(/blur\((1[2-6])px\)/);
    const nested = await page.locator(".panel *").evaluateAll((els) => els.filter((el) => el.isConnected && getComputedStyle(el).backdropFilter !== "none").length);
    expect(nested).toBe(0);
  });

  test("hover adjusts the border only: the panel never moves or tilts", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await settle(page);
    const target = panel(page, "socials");
    const before = await target.boundingBox();
    const borderBefore = await target.evaluate((el) => getComputedStyle(el).borderTopColor);
    await target.hover({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(350);
    expect(await target.boundingBox()).toEqual(before);
    expect(await target.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    expect(await target.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(borderBefore);
  });

  test("high-contrast preference falls back to opaque panels without backdrop filtering", async ({ browser }) => {
    const context = await browser.newContext({ contrast: "more" });
    const page = await context.newPage();
    await mockLanyard(page);
    await page.goto("/");
    const style = await page.locator(".panel--socials").evaluate((el) => ({ filter: getComputedStyle(el).backdropFilter, bg: getComputedStyle(el).backgroundColor }));
    expect(style).toEqual({ filter: "none", bg: "rgb(12, 12, 12)" });
    await context.close();
  });
});

test.describe("discord presence (Lanyard)", () => {
  test("renders every supported field that is actually returned, honestly", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord.locator(".discord__name")).toHaveText("Fixture User");
    await expect(discord.locator(".discord__username")).toHaveText("@fixture_user");
    await expect(discord.locator(".discord__status")).toContainText("online");
    await expect(discord.locator(".discord__status")).toContainText("desktop / mobile");
    await expect(discord.locator(".discord__connection")).toHaveText("live");

    // square avatar ~64px, banner ~100px
    const avatar = await discord.locator(".discord__avatar-frame").boundingBox();
    expect(avatar!.width).toBeCloseTo(64, 1);
    expect(avatar!.height).toBeCloseTo(64, 1);
    const banner = await discord.locator(".discord__banner").boundingBox();
    expect(banner!.height).toBeGreaterThanOrEqual(90);
    expect(banner!.height).toBeLessThanOrEqual(105);

    // badges derived from public flags only: no invented nitro/boost
    expect(await discord.locator(".badges .tag").allTextContents()).toEqual(["hypesquad bravery", "active developer"]);
    await expect(discord).not.toContainText(/nitro|boost/i);

    // bio comes from the approved Lanyard KV key (beating the owner's PROFILE_BIO fallback),
    // never from custom status, and unapproved KV keys are never rendered
    await expect(discord.locator(".discord__bio")).toHaveText("kv bio published through lanyard");
    await expect(discord).not.toContainText("owner-supplied bio fallback");
    await expect(discord).not.toContainText("kv-secret-must-not-render");
    expect(await page.content()).not.toContain("kv-secret-must-not-render");

    // custom status separate from bio; spotify + game activity
    await expect(discord.locator(".custom-status")).toContainText("tinkering with a fixture");
    const spotify = discord.locator(".activity").first();
    await expect(spotify).toContainText("Fixture Song");
    await expect(spotify).toContainText("Fixture Artist, Second Artist");
    await expect(spotify.locator("a")).toHaveAttribute("href", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    const game = discord.locator(".activity").nth(1);
    await expect(game).toContainText("Fixture Game");
    await expect(game).toContainText("In the hangar");
    await expect(game).toContainText(/1:0\d:\d\d elapsed/);
    // Lanyard returned no banner field, so the approved KV banner is used
    await expect(discord.locator(".discord__banner img")).toHaveAttribute("src", "https://images.example.test/kv-banner.png");
  });

  test("uses one shared WebSocket with the documented handshake and heartbeat", async ({ page }) => {
    const mock = await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    expect(mock.sockets).toHaveLength(1);
    expect(mock.received).toEqual([{ op: 2, d: { subscribe_to_id: "100000000000000001" } }]);
  });

  test("applies live PRESENCE_UPDATE events", async ({ page }) => {
    const mock = await mockLanyard(page);
    await page.goto("/");
    const status = panel(page, "discord").locator(".discord__status");
    await expect(status).toContainText("online");
    await waitForSubscription(mock);
    mock.push(presenceFixture({ discord_status: "dnd", spotify: null, listening_to_spotify: false, activities: [] }));
    await expect(status).toContainText("do not disturb");
    await expect(panel(page, "discord")).toContainText("no current activity");
    mock.push(presenceFixture({ discord_status: "offline", activities: [], spotify: null }));
    await expect(status).toContainText("offline");
  });

  test("a dropped socket keeps last data, says it is stale, and reconnects with backoff", async ({ page }) => {
    const mock = await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "discord").locator(".discord__connection")).toHaveText("live");
    await mock.sockets[0]!.close();
    await expect(panel(page, "discord").locator(".discord__connection")).toContainText("stale");
    await expect(panel(page, "discord").locator(".discord__name")).toHaveText("Fixture User");
    await expect.poll(() => mock.sockets.length, { timeout: 5000 }).toBe(2);
    await expect(panel(page, "discord").locator(".discord__connection")).toHaveText("live");
  });

  test("a disconnected API is shown as unavailable, never as offline", async ({ page }) => {
    await page.clock.install();
    const mock = await mockLanyard(page, presenceFixture(), { rest: "down", socket: "down" });
    await page.goto("/");
    await expireLanyardSettleTimer(page, mock);
    const discord = panel(page, "discord");
    await expect(discord).toContainText("presence unavailable");
    await expect(discord).not.toContainText("offline");
    await expect(discord).not.toContainText("online");
  });

  test("an untracked account is distinguished from an unreachable API", async ({ page }) => {
    await mockLanyard(page, presenceFixture(), { rest: "untracked", socket: "down" });
    await page.goto("/");
    await expect(panel(page, "discord")).toContainText("presence not tracked");
  });

  test("falls back to PROFILE_BIO and the quartz material when Lanyard KV has neither", async ({ page }) => {
    await mockLanyard(page, presenceFixture({ kv: { secret: "kv-secret-must-not-render" } }));
    await page.goto("/");
    const discord = panel(page, "discord");
    await expect(discord.locator(".discord__bio")).toHaveText("owner-supplied bio fallback");
    // nothing was returned or configured for the banner, so no fabricated image appears
    expect(await discord.locator(".discord__banner img").count()).toBe(0);
  });

  test("rejects an unsafe KV banner and keeps the material", async ({ page }) => {
    await mockLanyard(page, presenceFixture({ kv: { banner: "http://images.example.test/insecure.png", bio: "ok" } }));
    await page.goto("/");
    await expect(panel(page, "discord").locator(".discord__bio")).toHaveText("ok");
    expect(await panel(page, "discord").locator(".discord__banner img").count()).toBe(0);
  });

  test("a banner Discord actually returned beats the KV banner", async ({ page }) => {
    const data = presenceFixture();
    (data.discord_user as Record<string, unknown>).banner = "f".repeat(32);
    await mockLanyard(page, data);
    await page.goto("/");
    const src = await panel(page, "discord").locator(".discord__banner img").getAttribute("src");
    expect(src).toBe(`https://cdn.discordapp.com/banners/100000000000000001/${"f".repeat(32)}.png?size=480`);
  });

  test("no scroll is needed for the status block and the activity area scrolls internally when long", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    const body = panel(page, "discord").locator(".scroll");
    await expect(body).toHaveAttribute("aria-label", /scrollable/);
    const m = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, w: getComputedStyle(el).scrollbarWidth }));
    expect(m.w).toBe("none");
    expect(m.sh).toBeGreaterThanOrEqual(m.ch);
    // the whole panel is still exactly 390px: content scrolls rather than clipping or growing
    expect((await panel(page, "discord").boundingBox())!.height).toBeCloseTo(390, 1);
  });

  test("elapsed timers are not announced and no live region ticks every second", async ({ page }) => {
    await mockLanyard(page);
    await page.goto("/");
    await expect(panel(page, "discord").locator(".discord__name")).toBeVisible();
    const ticking = panel(page, "discord").locator(".activity__time");
    expect(await ticking.count()).toBeGreaterThan(0);
    for (const el of await ticking.all()) await expect(el).toHaveAttribute("aria-hidden", "true");
    expect(await panel(page, "discord").locator("[aria-live]").count()).toBe(0);
  });
});

import { expect, test } from "@playwright/test";
import { URLS } from "./constants";
import { mockLanyard, panel, presenceFixture } from "./helpers";

/**
 * The owner was unsure how their ListenBrainz username is spelled. A list of guesses must find the
 * real one, never invent data, and say so when part of the history is left out.
 */

test.describe("a list of guessed usernames, one of them real", () => {
  test.use({ baseURL: URLS.guessedUsernames });

  test("the panel shows the account that exists", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto("/");
    const listening = panel(page, "listening");
    await expect(listening.locator(".track").first()).toBeVisible();
    await expect(listening.locator(".track__title").first()).toContainText("Spotify Track 1");
    await expect(listening).not.toContainText("unavailable");
    await expect(listening).not.toContainText("not configured");
  });

  test("it says that only Spotify listens are shown, and how many were left out", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto("/");
    const listening = panel(page, "listening");
    await expect(listening.locator(".track")).toHaveCount(3);
    await expect(listening.locator(".stale-note", { hasText: "spotify listens only" })).toHaveText("spotify listens only · 2 from other sources hidden");
    await expect(listening).not.toContainText("Elsewhere Track");
  });

  test("the owner (diagnostics on) is told which account is being read", async ({ page }) => {
    await mockLanyard(page, presenceFixture());
    await page.goto("/");
    await expect(panel(page, "listening")).toContainText('owner hint: reading ListenBrainz account "fixture-mixed"');
  });

  test("/api/listening names the account that was read, and /status agrees", async ({ request }) => {
    const body = await (await request.get("/api/listening")).json();
    expect(body).toMatchObject({ status: "ok", data: { account: "fixture-mixed", spotifyOnly: true, omitted: 2 } });
    const status = await (await request.get("/status")).text();
    expect(status).toMatch(/LISTENBRAINZ_USERNAME\s+set, from environment/);
    expect(status).toMatch(/PASS\s+listenbrainz\s+account "fixture-mixed": 3 listens/);
  });
});

test("a healthy account with no narrowing shows no note", async ({ page }) => {
  await mockLanyard(page, presenceFixture());
  await page.goto(URLS.serverLanyard);
  await expect(panel(page, "listening").locator(".track").first()).toBeVisible();
  const listening = panel(page, "listening");
  await expect(listening).not.toContainText("spotify listens only");
  await expect(listening).not.toContainText("last known data");
});

test("visitors are never told which account is being read", async ({ page }) => {
  await mockLanyard(page, presenceFixture());
  await page.goto(URLS.healthy);
  await expect(panel(page, "listening").locator(".track").first()).toBeVisible();
  await expect(panel(page, "listening")).not.toContainText("owner hint");
});

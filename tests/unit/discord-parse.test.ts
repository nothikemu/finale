import { describe, expect, it } from "vitest";
import { avatarUrl, resolveActivityImage, spotifyThumbnail } from "@/data/discord/assets";
import { badgesFromPublicFlags } from "@/data/discord/badges";
import { parseLanyardPresence } from "@/data/discord/parse";

const ID = "100000000000000001"; // test fixture, not the owner's ID

function presence(overrides: Record<string, unknown> = {}) {
  return {
    discord_status: "online",
    active_on_discord_desktop: true,
    active_on_discord_mobile: false,
    active_on_discord_web: false,
    listening_to_spotify: false,
    spotify: null,
    kv: {},
    discord_user: {
      id: ID,
      username: "tester",
      global_name: "Test Er",
      avatar: "a".repeat(32),
      discriminator: "0",
      public_flags: (1 << 6) | (1 << 22),
    },
    activities: [],
    ...overrides,
  };
}

describe("parseLanyardPresence", () => {
  it("normalises the identity, status, platforms and badges", () => {
    const parsed = parseLanyardPresence(presence());
    expect(parsed).toMatchObject({
      status: "online",
      platforms: ["desktop"],
      user: { id: ID, username: "tester", displayName: "Test Er", bannerUrl: null, bio: null },
    });
    expect(parsed?.user.avatarUrl).toBe(`https://cdn.discordapp.com/avatars/${ID}/${"a".repeat(32)}.png?size=128`);
    expect(parsed?.badges.map((b) => b.key)).toEqual(["hypesquad-bravery", "active-developer"]);
  });

  it("returns null for payloads that are not a presence", () => {
    expect(parseLanyardPresence(null)).toBeNull();
    expect(parseLanyardPresence({})).toBeNull();
    expect(parseLanyardPresence(presence({ discord_status: "streaming" }))).toBeNull();
    expect(parseLanyardPresence(presence({ discord_user: { id: "x", username: "u" } }))).toBeNull();
  });

  it("separates custom status from activities and never treats it as a bio", () => {
    const parsed = parseLanyardPresence(
      presence({
        activities: [
          { id: "custom", type: 4, name: "Custom Status", state: "building things", emoji: { name: "🚀" } },
          { id: "g1", type: 0, name: "Factorio", details: "Base", state: "Tier 3", application_id: "1234567890123456", timestamps: { start: 1_700_000_000_000 }, assets: { large_image: "9876543210" } },
        ],
      }),
    );
    expect(parsed?.customStatus).toEqual({ text: "building things", emojiText: "🚀", emojiUrl: null });
    expect(parsed?.user.bio).toBeNull();
    expect(parsed?.activities).toHaveLength(1);
    expect(parsed?.activities[0]).toMatchObject({
      kind: "playing",
      name: "Factorio",
      start: 1_700_000_000_000,
      end: null,
      imageUrl: "https://cdn.discordapp.com/app-assets/1234567890123456/9876543210.png?size=128",
    });
  });

  it("renders Spotify from the dedicated field and drops the duplicate activity", () => {
    const parsed = parseLanyardPresence(
      presence({
        listening_to_spotify: true,
        spotify: {
          track_id: "4uLU6hMCjMI75M1A2tKUQC",
          song: "Song",
          artist: "A; B",
          album: "Album",
          album_art_url: "https://i.scdn.co/image/ab67616d0000b273abcdef",
          timestamps: { start: 1_700_000_000_000, end: 1_700_000_200_000 },
        },
        activities: [{ id: "spotify:1", type: 2, name: "Spotify" }],
      }),
    );
    expect(parsed?.activities).toEqual([]);
    expect(parsed?.spotify).toMatchObject({
      track: "Song",
      artist: "A, B",
      trackUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      artworkUrl: "https://i.scdn.co/image/ab67616d00001e02abcdef",
    });
  });

  it("only exposes the single approved KV key", () => {
    const raw = presence({ kv: { bio: "hello", secret: "nope" } });
    expect(parseLanyardPresence(raw)?.kvBio).toBeNull();
    expect(parseLanyardPresence(raw, { kvBioKey: "bio" })?.kvBio).toBe("hello");
    expect(JSON.stringify(parseLanyardPresence(raw, { kvBioKey: "bio" }))).not.toContain("nope");
  });

  it("uses a returned bio and banner only when the source supplies them", () => {
    const raw = presence();
    (raw.discord_user as Record<string, unknown>).bio = "from source";
    (raw.discord_user as Record<string, unknown>).banner = "b".repeat(32);
    const parsed = parseLanyardPresence(raw);
    expect(parsed?.user.bio).toBe("from source");
    expect(parsed?.user.bannerUrl).toBe(`https://cdn.discordapp.com/banners/${ID}/${"b".repeat(32)}.png?size=480`);
  });
});

describe("asset resolution", () => {
  it("resolves known asset schemes and drops unknown ones", () => {
    expect(resolveActivityImage("mp:external/abc/https/example.com/x.png", undefined)).toBe(
      "https://media.discordapp.net/external/abc/https/example.com/x.png",
    );
    expect(resolveActivityImage("spotify:ab67616d0000b273aabbccddeeff", undefined)).toBe("https://i.scdn.co/image/ab67616d0000b273aabbccddeeff");
    expect(resolveActivityImage("youtube:abc", undefined)).toBeNull();
    expect(resolveActivityImage("mp:evil/../x", undefined)).toBeNull();
    expect(resolveActivityImage("1234567890", undefined)).toBeNull();
  });
  it("passes unknown Spotify image URLs through and rejects other hosts", () => {
    expect(spotifyThumbnail("https://i.scdn.co/image/other")).toBe("https://i.scdn.co/image/other");
    expect(spotifyThumbnail("https://evil.test/image/ab67616d0000b273x")).toBeNull();
  });
  it("derives Discord's default avatar from the snowflake for new-style usernames", () => {
    // (175928847299117063 >> 22) % 6 === 2, computed independently of the implementation.
    expect(avatarUrl("175928847299117063", null, "0")).toBe("https://cdn.discordapp.com/embed/avatars/2.png");
    // Legacy discriminators use discriminator % 5 (1338 % 5 === 3).
    expect(avatarUrl("175928847299117063", null, "1338")).toBe("https://cdn.discordapp.com/embed/avatars/3.png");
  });
});

describe("badgesFromPublicFlags", () => {
  it("never invents badges", () => {
    expect(badgesFromPublicFlags(0)).toEqual([]);
    expect(badgesFromPublicFlags(undefined)).toEqual([]);
    expect(badgesFromPublicFlags(1 << 10)).toEqual([]);
  });
});

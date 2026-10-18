import { describe, expect, it } from "vitest";
import { cleanMultiline, cleanText, safeHttpsUrl, spotifyTrackUrl } from "@/lib/sanitize";

describe("cleanText", () => {
  it("strips bidi overrides and control characters and collapses whitespace", () => {
    expect(cleanText("a‮b\u0000c  \n d")).toBe("abc d");
  });
  it("keeps zero-width joiners so emoji sequences survive", () => {
    expect(cleanText("👩‍🚀")).toBe("👩‍🚀");
  });
  it("rejects non-strings and empty results", () => {
    expect(cleanText(42)).toBeNull();
    expect(cleanText("  ​ ")).toBeNull();
  });
  it("truncates by code point, never splitting a surrogate pair", () => {
    expect(cleanText("🚀🚀🚀🚀", 3)).toBe("🚀🚀…");
  });
});

describe("cleanMultiline", () => {
  it("keeps single newlines and collapses blank runs", () => {
    expect(cleanMultiline("a\r\nb\n\n\n\nc")).toBe("a\nb\n\nc");
  });
});

describe("safeHttpsUrl", () => {
  it("accepts https only, without credentials", () => {
    expect(safeHttpsUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeHttpsUrl("http://example.com/a.png")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("https://user:pw@example.com/")).toBeNull();
  });
  it("enforces host allow-lists including wildcard subdomains", () => {
    expect(safeHttpsUrl("https://i.scdn.co/x", { hosts: ["i.scdn.co"] })).not.toBeNull();
    expect(safeHttpsUrl("https://evil.example/x", { hosts: ["i.scdn.co"] })).toBeNull();
    expect(safeHttpsUrl("https://a.archive.org/x", { hosts: ["*.archive.org"] })).not.toBeNull();
    expect(safeHttpsUrl("https://archive.org.evil.test/x", { hosts: ["*.archive.org"] })).toBeNull();
  });
});

describe("spotifyTrackUrl", () => {
  const id = "4uLU6hMCjMI75M1A2tKUQC";
  it("canonicalises open.spotify.com track links", () => {
    expect(spotifyTrackUrl(`https://open.spotify.com/track/${id}?si=abc`)).toBe(`https://open.spotify.com/track/${id}`);
    expect(spotifyTrackUrl(`https://open.spotify.com/intl-ja/track/${id}`)).toBe(`https://open.spotify.com/track/${id}`);
  });
  it("rejects other hosts and malformed ids", () => {
    expect(spotifyTrackUrl(`https://open.spotify.com.evil.test/track/${id}`)).toBeNull();
    expect(spotifyTrackUrl("https://open.spotify.com/track/short")).toBeNull();
  });
});

describe("cleanText: characters that are invisible but not harmless", () => {
  it("strips soft hyphens, fillers, joiners that hide text, Arabic letter marks and the tag block", () => {
    const hidden = ["\u00AD", "\u034F", "\u061C", "\u180E", "\u3164", "\uFFA0", "\u2060", "\u{E0041}", "\u{E007F}", "\u202E", "\u2066", "\uFEFF"];
    for (const character of hidden) expect(cleanText(`pay${character}pal`), JSON.stringify(character)).toBe("paypal");
  });

  it("keeps what real text and emoji need: ZWJ, ZWNJ and variation selectors", () => {
    expect(cleanText("❤️")).toBe("❤️");
    expect(cleanText("می\u200Cخواهم")).toBe("می\u200Cخواهم");
    expect(cleanText("👨\u200D👩\u200D👧")).toBe("👨\u200D👩\u200D👧");
  });

  it("source of the pattern uses escapes, so nothing invisible hides in the file", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync("src/lib/sanitize.ts", "utf8"));
    expect(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/.test(source)).toBe(false);
  });
});

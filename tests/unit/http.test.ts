import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUpstreamText, isUpstreamError, UpstreamError } from "@/lib/server/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (body: string, headers: Record<string, string> = {}) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers })));

describe("fetchUpstreamText", () => {
  it("returns a body within the limit", async () => {
    respond("hello");
    await expect(fetchUpstreamText("https://example.test/", { service: "svc" }, 100)).resolves.toBe("hello");
  });

  it("refuses a body that declares itself too large, without reading it", async () => {
    const body = new Response("x".repeat(10), { status: 200, headers: { "content-length": "5000" } });
    const text = vi.spyOn(body, "text");
    vi.stubGlobal("fetch", vi.fn(async () => body));
    await expect(fetchUpstreamText("https://example.test/", { service: "svc" }, 100)).rejects.toMatchObject({ kind: "invalid-response" });
    expect(text).not.toHaveBeenCalled();
  });

  it("refuses a body that does not declare its size but turns out too long, and an empty one", async () => {
    respond("x".repeat(500));
    await expect(fetchUpstreamText("https://example.test/", { service: "svc" }, 100)).rejects.toMatchObject({ kind: "invalid-response" });
    respond("");
    await expect(fetchUpstreamText("https://example.test/", { service: "svc" }, 100)).rejects.toMatchObject({ kind: "invalid-response" });
  });
});

describe("isUpstreamError", () => {
  it("recognises the class and a same-shaped error from another bundle, and nothing else", () => {
    expect(isUpstreamError(new UpstreamError("network", "svc"))).toBe(true);
    class Foreign extends Error {
      kind = "network";
      constructor() {
        super("x");
        this.name = "UpstreamError";
      }
    }
    expect(isUpstreamError(new Foreign())).toBe(true);
    expect(isUpstreamError(new Error("UpstreamError"))).toBe(false);
    expect(isUpstreamError({ name: "UpstreamError", kind: "network" })).toBe(false);
    expect(isUpstreamError(null)).toBe(false);
  });
});

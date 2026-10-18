import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identity } from "@/config/identity";
import { diagnosticsReason, hintsEnabled, ownerHint } from "@/lib/server/diagnostics";
import { isLoopbackHost } from "@/lib/server/origin";

describe("when owner diagnostics are shown", () => {
  beforeEach(() => {
    delete process.env.SHOW_DIAGNOSTICS;
    identity.showDiagnostics = false;
  });
  afterEach(() => {
    delete process.env.SHOW_DIAGNOSTICS;
    identity.showDiagnostics = false;
    vi.unstubAllEnvs();
  });

  it("never in a production build unless the owner asked, whatever the request looks like", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(diagnosticsReason()).toBeNull();
    expect(hintsEnabled()).toBe(false);
    expect(ownerHint("a hint")).toBeUndefined();
  });

  it("when the owner asks, from the environment or from identity.ts", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SHOW_DIAGNOSTICS = "1";
    expect(diagnosticsReason()).toBe("SHOW_DIAGNOSTICS");
    expect(ownerHint("a hint")).toBe("a hint");
    delete process.env.SHOW_DIAGNOSTICS;
    identity.showDiagnostics = true;
    expect(diagnosticsReason()).toBe("SHOW_DIAGNOSTICS");
  });

  it("in a development build", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(diagnosticsReason()).toBe("development build");
  });

  it("SHOW_DIAGNOSTICS=0 wins over everything, development and identity.ts included", () => {
    process.env.SHOW_DIAGNOSTICS = "0";
    identity.showDiagnostics = true;
    vi.stubEnv("NODE_ENV", "development");
    expect(diagnosticsReason()).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(diagnosticsReason()).toBeNull();
  });
});

describe("isLoopbackHost (only decides http versus https for a local link preview)", () => {
  it("recognises the machine running the server, with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "LOCALHOST:8080", "127.0.0.1", "127.0.0.1:3101", "127.1.2.3:80", "[::1]", "[::1]:3000", "app.localhost:3000"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("does not mistake a public name for it", () => {
    for (const host of ["example.com", "nothikemu.vercel.app", "localhost.example.com", "mylocalhost", "127.0.0.1.example.com", "192.168.1.20:3000", "10.0.0.1", "0.0.0.0", "[2001:db8::1]:443", "", "  "]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});

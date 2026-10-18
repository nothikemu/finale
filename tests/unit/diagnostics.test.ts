import { describe, expect, it } from "vitest";
import { isLoopbackHost, namesOnlyThisMachine } from "@/lib/server/diagnostics";

describe("isLoopbackHost", () => {
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

describe("namesOnlyThisMachine", () => {
  it("accepts what Next.js writes into the forwarded headers for a direct request", () => {
    for (const value of ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost:3101", "127.0.0.1, ::1", "for=127.0.0.1;host=localhost:3000", 'for="[::1]"']) {
      expect(namesOnlyThisMachine(value), value).toBe(true);
    }
  });

  it("rejects anything that names another machine, even next to a local address", () => {
    for (const value of ["203.0.113.9", "203.0.113.9, 127.0.0.1", "127.0.0.1, 198.51.100.7", "dashboard.example.com", "for=203.0.113.9;host=dashboard.example.com", "::ffff:203.0.113.9"]) {
      expect(namesOnlyThisMachine(value), value).toBe(false);
    }
  });
});

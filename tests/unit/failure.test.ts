import { describe, expect, it } from "vitest";
import { describeFailure } from "@/lib/failure";

describe("describeFailure", () => {
  it("names the missing variable", () => {
    expect(describeFailure({ status: "missing-config", missing: ["LISTENBRAINZ_TOKEN"] })).toContain("LISTENBRAINZ_TOKEN");
    expect(describeFailure({ status: "missing-config", missing: ["LISTENBRAINZ_USERNAME", "LISTENBRAINZ_TOKEN"] })).toContain("LISTENBRAINZ_USERNAME or LISTENBRAINZ_TOKEN");
    expect(describeFailure({ status: "missing-config", missing: ["X"] })).toContain("/status");
  });
  it("explains each failure reason in actionable terms and keeps the typed detail", () => {
    const text = (reason: "auth" | "not-found" | "rate-limited" | "network" | "upstream" | "invalid-response") => describeFailure({ status: "unavailable", reason, detail: `svc: ${reason}` })!;
    expect(text("auth")).toMatch(/svc: auth: .*rejected the credential/);
    expect(text("not-found")).toMatch(/does not know that account/);
    expect(text("rate-limited")).toMatch(/rate limiting/);
    expect(text("network")).toMatch(/internet access/);
    expect(text("upstream")).toMatch(/returned an error/);
    expect(text("invalid-response")).toMatch(/format/);
    for (const reason of ["auth", "network"] as const) expect(text(reason)).toMatch(/npm run doctor/);
  });
  it("has nothing to say about healthy states", () => {
    expect(describeFailure({ status: "ok", data: 1, fetchedAt: 0, stale: false })).toBeUndefined();
  });
});

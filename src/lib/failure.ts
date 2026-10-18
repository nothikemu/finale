import type { Loaded } from "@/data/types";

const FIXES: Record<string, string> = {
  auth: "the service rejected the credential: check it is correct, not expired, and has the access the README describes",
  "not-found": "the service does not know that account: check its spelling in your configuration",
  "bad-config": "the setting was read, but nothing in it can be used: remove stray characters (a ListenBrainz username is the name in your profile address)",
  "rate-limited": "the service is rate limiting this server: wait a few minutes (for GitHub, adding a token raises the limit; ListenBrainz needs none)",
  network: "this server could not reach the service: check its internet access, proxy or firewall",
  upstream: "the service returned an error: try again shortly",
  "invalid-response": "the service answered in a format this site did not expect",
};

/**
 * One owner-facing sentence explaining a non-ok panel state. Contains the
 * service and status only, never a credential. Safe to use in client code.
 */
export function describeFailure(result: Loaded<unknown>): string | undefined {
  if (result.status === "missing-config") {
    // several entries mean any one of them is enough (e.g. a ListenBrainz username or token)
    const names = result.missing.join(" or ");
    return `${names} did not reach this server. Open /status to see what it received (see README)`;
  }
  if (result.status !== "unavailable") return undefined;
  const detail = result.detail ? `${result.detail}: ` : "";
  return `${detail}${FIXES[result.reason] ?? "unknown failure"}. open the /api routes or run npm run doctor`;
}

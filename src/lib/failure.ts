import type { Loaded } from "@/data/types";

const FIXES: Record<string, string> = {
  auth: "the service rejected the credential: check it is correct, not expired, and has the access the README describes",
  "rate-limited": "the service is rate limiting this server: wait a few minutes (adding a token raises GitHub's limit)",
  network: "this server could not reach the service: check its internet access, proxy or firewall",
  upstream: "the service returned an error: try again shortly",
  "invalid-response": "the service answered in a format this site did not expect",
};

/**
 * One owner-facing sentence explaining a non-ok panel state. Contains the
 * service and status only, never a credential. Safe to use in client code.
 */
export function describeFailure(result: Loaded<unknown>): string | undefined {
  if (result.status === "missing-config") return `set ${result.missing.join(", ")} (see README)`;
  if (result.status !== "unavailable") return undefined;
  const detail = result.detail ? `${result.detail}: ` : "";
  return `${detail}${FIXES[result.reason] ?? "unknown failure"}. open the /api routes or run npm run doctor`;
}

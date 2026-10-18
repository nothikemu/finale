import "server-only";

import { headers } from "next/headers";
import type { Loaded } from "@/data/types";
import { hint } from "@/lib/dev-hint";
import { describeFailure } from "@/lib/failure";
import { serverEnv } from "./env";

/**
 * Owner-facing hints (and /status) are for whoever runs the site, never for visitors.
 * They appear when, in this order:
 *   1. the owner turned them off (SHOW_DIAGNOSTICS=0): never, even on localhost;
 *   2. the owner turned them on (SHOW_DIAGNOSTICS=1, or showDiagnostics in src/config/identity.ts);
 *   3. this is a development build;
 *   4. the page is being viewed from the machine running the server (localhost, not forwarded by a proxy).
 * Rule 4 matters because a configuration that fails to load takes SHOW_DIAGNOSTICS down with it;
 * the owner opening http://localhost:3000 should still be told why. Hints name settings only.
 */
export type DiagnosticsReason = "SHOW_DIAGNOSTICS" | "development build" | "local viewer";

/** True for localhost, 127.x.x.x and ::1 hosts, with or without a port. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\](?::\d+)?$/g, "")
    .replace(/(?<!:):\d+$/, "")
    .replace(/^::ffff:/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || /^127(?:\.\d{1,3}){3}$/.test(name);
}

/**
 * True when a header that lists where a request came from (X-Forwarded-For, Forwarded, ...) names
 * only this machine. Next.js itself fills X-Forwarded-For/-Host in from the socket and Host on every
 * request, so their mere presence proves nothing; a proxy in front of the site puts a real client
 * address or a public host there.
 */
export function namesOnlyThisMachine(value: string): boolean {
  const tokens = value
    .split(/[;,\s]+/)
    .map((token) => token.replace(/^(?:for|host|by)=/i, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
  return tokens.every((token) => isLoopbackHost(token));
}

/** Headers a proxy or CDN adds. If any names an address that is not this machine, the viewer is not on it. */
const FORWARDED_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip", "x-vercel-forwarded-for"];

export async function diagnosticsReason(): Promise<DiagnosticsReason | null> {
  const setting = serverEnv.diagnosticsSetting;
  if (setting === false) return null;
  if (setting === true) return "SHOW_DIAGNOSTICS";
  if (process.env.NODE_ENV !== "production") return "development build";
  try {
    const request = await headers();
    // A reverse proxy may rewrite Host to localhost, but it still reports who really asked.
    if (FORWARDED_HEADERS.some((name) => request.has(name) && !namesOnlyThisMachine(request.get(name) ?? ""))) return null;
    return isLoopbackHost(request.get("host")) ? "local viewer" : null;
  } catch {
    // Not inside a request (a build step or a test): there is no viewer to help.
    return null;
  }
}

export const hintsEnabled = async (): Promise<boolean> => (await diagnosticsReason()) !== null;

/** Owner-facing hint, or undefined for visitors. */
export const ownerHint = async (text: string | undefined): Promise<string | undefined> => hint(text, await hintsEnabled());

export const failureHint = async (result: Loaded<unknown>): Promise<string | undefined> => ownerHint(describeFailure(result));

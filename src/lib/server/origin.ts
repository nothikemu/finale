import "server-only";

import { headers } from "next/headers";
import { isLoopbackHost } from "./diagnostics";

/**
 * The address this site is being served from, for absolute URLs in link previews.
 *
 * SITE_URL wins when set (use it behind a proxy that hides the real host). Vercel's production
 * hostname is used when present. Otherwise the origin of the request itself is used, so previews are
 * correct on any host without configuration.
 */
export async function siteOrigin(): Promise<URL | undefined> {
  const explicit = process.env.SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const configured = explicit || (vercel ? `https://${vercel}` : "");
  if (configured) {
    try {
      return new URL(configured.includes("://") ? configured : `https://${configured}`);
    } catch {
      // fall through to the request's own origin
    }
  }
  try {
    const request = await headers();
    const host = request.get("x-forwarded-host")?.split(",")[0]?.trim() || request.get("host");
    if (!host) return undefined;
    const proto = request.get("x-forwarded-proto")?.split(",")[0]?.trim() || (isLoopbackHost(host) ? "http" : "https");
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}

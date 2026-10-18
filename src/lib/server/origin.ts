import "server-only";

import { headers } from "next/headers";

/** True for localhost, 127.x.x.x and ::1 hosts, with or without a port. Used only to pick http for local previews. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\](?::\d+)?$/g, "")
    .replace(/(?<!:):\d+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || /^127(?:\.\d{1,3}){3}$/.test(name);
}

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/i;

/**
 * The address this site is being served from, for absolute URLs in link previews.
 *
 * SITE_URL wins when set (set it on any host that is not Vercel: behind a proxy the real host and scheme
 * are often hidden). Vercel's production hostname is used when present. Otherwise the origin of the
 * request itself is used, which is right for a direct connection and for proxies that forward the
 * usual headers.
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
    // These headers are chosen by whoever sent the request: only a well-formed host and scheme are used, and a
    // malformed forwarded host falls back to the Host the connection itself used.
    const candidates = [request.get("x-forwarded-host")?.split(",")[0], request.get("host")].map((value) => (value ?? "").trim().toLowerCase());
    const host = candidates.find((value) => HOST_SHAPE.test(value));
    if (!host) return undefined;
    const forwarded = request.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const proto = forwarded === "http" || forwarded === "https" ? forwarded : isLoopbackHost(host) ? "http" : "https";
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}

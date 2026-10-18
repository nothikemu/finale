import "server-only";

import type { Loaded } from "@/data/types";

/** Maps a loaded state to an HTTP response with sensible CDN caching. */
export function loadedResponse<T>(result: Loaded<T>, sMaxAgeSeconds: number): Response {
  if (result.status === "ok") {
    return Response.json(result, {
      headers: { "Cache-Control": `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${sMaxAgeSeconds * 2}` },
    });
  }
  const status = result.status === "missing-config" ? 503 : result.reason === "rate-limited" ? 429 : 502;
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

import { diagnosticsReason } from "@/lib/server/diagnostics";
import { buildStatusReport } from "@/lib/server/status";

export const dynamic = "force-dynamic";
// Platform function limit (seconds). Each upstream is cut off after 12 s, so a page never needs more than this.
export const maxDuration = 30;

const PRIVATE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/**
 * Owner diagnostics: what this server received and what each integration says.
 * Visitors get a plain 404; it only exists while hints are enabled
 * (see src/lib/server/diagnostics.ts: SHOW_DIAGNOSTICS or a development build).
 */
export async function GET() {
  const reason = diagnosticsReason();
  if (!reason) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await buildStatusReport(reason), { headers: PRIVATE_HEADERS });
}

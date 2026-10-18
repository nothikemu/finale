import { cacheTtl } from "@/config/site";
import { loadPresence } from "@/data/discord/snapshot";
import { loadedResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return loadedResponse(await loadPresence(), cacheTtl.presence / 1000 / 2);
}

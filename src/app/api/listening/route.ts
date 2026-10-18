import { cacheTtl } from "@/config/site";
import { loadListening } from "@/data/listenbrainz";
import { loadedResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";
// Platform function limit (seconds). Each upstream is cut off after 12 s, so a page never needs more than this.
export const maxDuration = 30;

export async function GET() {
  return loadedResponse(await loadListening(), cacheTtl.nowPlaying / 1000 - 5);
}

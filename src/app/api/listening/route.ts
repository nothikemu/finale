import { cacheTtl } from "@/config/site";
import { loadListening } from "@/data/listenbrainz";
import { loadedResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return loadedResponse(await loadListening(), cacheTtl.nowPlaying / 1000 - 5);
}

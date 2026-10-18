import { cacheTtl } from "@/config/site";
import { loadContributions } from "@/data/github/contributions";
import { loadedResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return loadedResponse(await loadContributions(), cacheTtl.contributions / 1000);
}

import { cacheTtl } from "@/config/site";
import { loadProjects } from "@/data/github/projects";
import { loadedResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return loadedResponse(await loadProjects(), cacheTtl.projects / 1000);
}

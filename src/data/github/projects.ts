import "server-only";

import { z } from "zod";
import { cacheTtl, site } from "@/config/site";
import type { Loaded, Repository } from "@/data/types";
import { cleanText } from "@/lib/sanitize";
import { toLoaded } from "@/lib/server/cache";
import { serverEnv } from "@/lib/server/env";
import { fetchUpstreamJson, UpstreamError } from "@/lib/server/http";

const PER_PAGE = 100;
/** Safety net against a runaway Link chain; 50 pages is 5,000 repositories. */
const MAX_PAGES = 50;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

const repositorySchema = z.object({
  id: z.number(),
  name: z.string().regex(REPO_NAME),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  archived: z.boolean(),
  fork: z.boolean(),
  updated_at: z.string(),
  private: z.boolean().optional(),
});

export function normalizeRepositories(payload: unknown, username: string): { repositories: Repository[]; skipped: number } {
  if (!Array.isArray(payload)) return { repositories: [], skipped: 0 };
  const repositories: Repository[] = [];
  let skipped = 0;
  for (const item of payload) {
    const parsed = repositorySchema.safeParse(item);
    // Defence in depth: this endpoint only lists public repositories.
    if (!parsed.success || parsed.data.private) {
      skipped += 1;
      continue;
    }
    const repo = parsed.data;
    repositories.push({
      id: repo.id,
      name: repo.name,
      // Built from validated parts rather than trusting html_url.
      url: `https://github.com/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}`,
      description: cleanText(repo.description, 280),
      language: cleanText(repo.language, 40),
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      archived: repo.archived,
      fork: repo.fork,
      updatedAt: repo.updated_at,
    });
  }
  return { repositories, skipped };
}

function hasNextPage(link: string | null): boolean {
  return link !== null && /<[^>]+>;\s*rel="next"/.test(link);
}

async function fetchAllRepositories(username: string, token: string | undefined): Promise<Repository[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  // The token only raises the rate limit here; /users/{u}/repos lists public repositories.
  if (token) headers.authorization = `Bearer ${token}`;

  const all: Repository[] = [];
  let skipped = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=${PER_PAGE}&sort=updated&direction=desc&page=${page}`;
    const { json, headers: responseHeaders } = await fetchUpstreamJson(url, { service: "github-repos", init: { headers } });
    const result = normalizeRepositories(json, username);
    all.push(...result.repositories);
    skipped += result.skipped;
    const count = Array.isArray(json) ? json.length : 0;
    // Follow Link: rel="next"; fall back to page size when the header is absent.
    const more = responseHeaders.has("link") ? hasNextPage(responseHeaders.get("link")) : count === PER_PAGE;
    if (!more) break;
  }
  if (skipped > 0) console.warn(`[github-repos] skipped ${skipped} malformed repository record(s)`);

  // Keep the most-recently-updated-first order even if pages overlapped while paginating.
  const seen = new Set<number>();
  return all
    .filter((repo) => (seen.has(repo.id) ? false : (seen.add(repo.id), true)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * Public repositories need no credential. A token only raises the rate limit,
 * and GitHub answers 401 to a bad one even on public endpoints, so a rejected
 * token falls back to anonymous access instead of hiding every repository.
 */
async function fetchWithTokenFallback(username: string): Promise<Repository[]> {
  const token = serverEnv.githubToken;
  try {
    return await fetchAllRepositories(username, token);
  } catch (error) {
    if (token && error instanceof UpstreamError && error.kind === "auth") {
      console.warn("[github] GITHUB_TOKEN was rejected (401); listing public repositories without it");
      return fetchAllRepositories(username, undefined);
    }
    throw error;
  }
}

export function loadProjects(username: string = site.githubUsername): Promise<Loaded<Repository[]>> {
  return toLoaded({
    key: `github:repos:${username}`,
    ttlMs: cacheTtl.projects,
    load: () => fetchWithTokenFallback(username),
  });
}

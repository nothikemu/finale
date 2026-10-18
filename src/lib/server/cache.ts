import "server-only";

import type { Loaded } from "@/data/types";
import { isMissingConfigError } from "./env";
import { isUpstreamError, UpstreamError } from "./http";

/**
 * In-process cache with:
 *  - TTL freshness,
 *  - de-duplication of simultaneous loads for the same key,
 *  - last-known-good data served (marked stale) when a refresh fails,
 *  - cool-downs that honour Retry-After, and a short negative cache so a dead
 *    upstream is not hammered by every request.
 *
 * State is held on globalThis so dev-server module reloads do not reset it.
 */

interface Entry {
  value?: unknown;
  fetchedAt?: number;
  inflight?: Promise<unknown>;
  /** Do not call upstream before this time. */
  blockedUntil: number;
  lastError?: UpstreamError;
}

const store: Map<string, Entry> = ((globalThis as { __dashboardCache?: Map<string, Entry> }).__dashboardCache ??= new Map());

/** Data older than this is dropped rather than shown as "stale". */
const MAX_STALE_MS = 24 * 60 * 60_000;
const ERROR_COOLDOWN_MS = 10_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

export interface CacheOptions<T> {
  key: string;
  ttlMs: number;
  load: () => Promise<T>;
}

export interface CacheResult<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

export function clearCache(): void {
  store.clear();
}

export async function cached<T>({ key, ttlMs, load }: CacheOptions<T>): Promise<CacheResult<T>> {
  let entry = store.get(key);
  if (!entry) {
    entry = { blockedUntil: 0 };
    store.set(key, entry);
  }
  const now = Date.now();
  const hasValue = entry.fetchedAt !== undefined && now - entry.fetchedAt < MAX_STALE_MS;
  if (!hasValue) {
    entry.value = undefined;
    entry.fetchedAt = undefined;
  }

  if (entry.fetchedAt !== undefined && now - entry.fetchedAt < ttlMs) {
    return { data: entry.value as T, fetchedAt: entry.fetchedAt, stale: false };
  }
  if (entry.inflight) return resolveInflight<T>(entry);

  if (now < entry.blockedUntil) {
    if (entry.fetchedAt !== undefined) return { data: entry.value as T, fetchedAt: entry.fetchedAt, stale: true };
    throw entry.lastError ?? new UpstreamError("upstream", key);
  }

  const target = entry;
  target.inflight = (async () => {
    try {
      const value = await load();
      target.value = value;
      target.fetchedAt = Date.now();
      target.blockedUntil = 0;
      target.lastError = undefined;
      return value;
    } catch (error) {
      if (isMissingConfigError(error)) throw error;
      const upstream = isUpstreamError(error) ? error : new UpstreamError("upstream", key);
      const cooldown = Math.min(MAX_COOLDOWN_MS, upstream.retryAfterMs ?? ERROR_COOLDOWN_MS);
      target.blockedUntil = Date.now() + Math.max(cooldown, 1000);
      target.lastError = upstream;
      throw upstream;
    } finally {
      target.inflight = undefined;
    }
  })();
  return resolveInflight<T>(target);
}

async function resolveInflight<T>(entry: Entry): Promise<CacheResult<T>> {
  try {
    const value = (await entry.inflight) as T;
    return { data: value, fetchedAt: entry.fetchedAt ?? Date.now(), stale: false };
  } catch (error) {
    if (entry.fetchedAt !== undefined) return { data: entry.value as T, fetchedAt: entry.fetchedAt, stale: true };
    throw error;
  }
}

/** Runs a cached loader and folds every failure into a renderable state. */
export async function toLoaded<T>(options: CacheOptions<T>): Promise<Loaded<T>> {
  try {
    const result = await cached(options);
    return { status: "ok", data: result.data, fetchedAt: result.fetchedAt, stale: result.stale };
  } catch (error) {
    if (isMissingConfigError(error)) return { status: "missing-config", missing: error.missing };
    const upstream = isUpstreamError(error) ? error : new UpstreamError("upstream", options.key);
    // Status and kind only: never the request, headers or credentials.
    console.warn(`[upstream] ${upstream.message}`);
    return { status: "unavailable", reason: upstream.reason, detail: upstream.message };
  }
}

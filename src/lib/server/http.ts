import "server-only";

import type { UnavailableReason } from "@/data/types";

export type UpstreamErrorKind = "rate-limited" | "auth" | "not-found" | "network" | "timeout" | "upstream" | "invalid-response";

/**
 * A normalised upstream failure. Messages are composed here from the service
 * name and status only, never from request headers or bodies, so credentials
 * cannot leak through error text.
 */
export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamErrorKind,
    readonly service: string,
    readonly status?: number,
    /** Milliseconds the upstream asked us to wait. */
    readonly retryAfterMs?: number,
  ) {
    super(`${service}: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "UpstreamError";
  }

  get reason(): UnavailableReason {
    switch (this.kind) {
      case "rate-limited":
        return "rate-limited";
      case "auth":
        return "auth";
      case "network":
      case "timeout":
        return "network";
      case "invalid-response":
        return "invalid-response";
      default:
        return "upstream";
    }
  }
}

export interface FetchOptions {
  service: string;
  init?: RequestInit;
  timeoutMs?: number;
  /** Extra attempts after the first for network errors and 5xx. */
  retries?: number;
  /** Longest Retry-After we are willing to sleep through inside one request. */
  maxInlineWaitMs?: number;
}

const USER_AGENT = "nothikemu-dashboard/1.0 (+https://github.com/nothikemu)";

export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  // GitHub primary limits and ListenBrainz both advertise when the window resets.
  if (headers.get("x-ratelimit-remaining") === "0") {
    const resetEpoch = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(resetEpoch) && resetEpoch > 1e9) return Math.max(0, resetEpoch * 1000 - now);
    const resetIn = Number(headers.get("x-ratelimit-reset-in"));
    if (Number.isFinite(resetIn)) return Math.max(0, resetIn * 1000);
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoff(attempt: number): number {
  const base = 250 * 2 ** attempt;
  return base / 2 + Math.random() * (base / 2);
}

/**
 * GET/POST with a timeout, bounded retries and Retry-After handling. Resolves
 * only with a 2xx response; everything else throws an UpstreamError.
 */
export async function fetchUpstream(url: string, options: FetchOptions): Promise<Response> {
  const { service, init, timeoutMs = 8000, retries = 2, maxInlineWaitMs = 2000 } = options;
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);

  let lastError: UpstreamError | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      lastError = new UpstreamError(timedOut ? "timeout" : "network", service);
      if (attempt < retries) await sleep(backoff(attempt));
      continue;
    }

    if (response.ok) return response;
    // Drain so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);

    const { status } = response;
    const retryAfterMs = parseRetryAfter(response.headers);
    const rateLimited = status === 429 || ((status === 403 || status === 503) && retryAfterMs !== undefined);
    if (rateLimited) {
      lastError = new UpstreamError("rate-limited", service, status, retryAfterMs);
      if (retryAfterMs !== undefined && retryAfterMs <= maxInlineWaitMs && attempt < retries) {
        await sleep(retryAfterMs);
        continue;
      }
      throw lastError;
    }
    if (status === 401 || status === 403) throw new UpstreamError("auth", service, status);
    if (status === 404) throw new UpstreamError("not-found", service, status);
    lastError = new UpstreamError("upstream", service, status);
    if (status >= 500 && attempt < retries) {
      await sleep(backoff(attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new UpstreamError("network", service);
}

/** Like fetchUpstreamJson, for HTML. Bodies over `maxBytes` are rejected rather than buffered. */
export async function fetchUpstreamText(url: string, options: FetchOptions, maxBytes = 2_000_000): Promise<string> {
  const response = await fetchUpstream(url, options);
  const text = await response.text().catch(() => "");
  if (!text || text.length > maxBytes) throw new UpstreamError("invalid-response", options.service, response.status);
  return text;
}

export async function fetchUpstreamJson(url: string, options: FetchOptions): Promise<{ json: unknown; headers: Headers }> {
  const response = await fetchUpstream(url, options);
  try {
    return { json: await response.json(), headers: response.headers };
  } catch {
    throw new UpstreamError("invalid-response", options.service, response.status);
  }
}

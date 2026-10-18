import "server-only";

import { cacheTtl, site } from "@/config/site";
import type { Loaded } from "@/data/types";
import { asRecord } from "@/lib/guards";
import { toLoaded } from "@/lib/server/cache";
import { serverEnv } from "@/lib/server/env";
import { fetchUpstreamJson, isUpstreamError, UpstreamError } from "@/lib/server/http";
import { isSnowflake } from "./assets";
import { lanyardRestUrl } from "./lanyard-store";
import { parseLanyardPresence, presenceProblem } from "./parse";
import type { DiscordPresence } from "./types";

/**
 * A server-side read of Lanyard's REST endpoint. The browser normally talks to
 * Lanyard itself (live socket), but anything between a visitor and
 * api.lanyard.rest (an ad blocker, a VPN, a firewall) would otherwise leave the
 * panel empty. GitHub and ListenBrainz are already fetched by the server, so
 * this gives Discord the same second route. Nothing here needs a credential.
 */
export interface PresenceSnapshot {
  /** False when Lanyard says this account is not in its server. */
  tracked: boolean;
  presence: DiscordPresence | null;
}

/*
 * The browser gives this route 8 s (REST_TIMEOUT_MS in lanyard-store.ts); two 3 s attempts plus a short
 * pause fit inside that, so a Lanyard that silently drops requests is reported, not timed out blindly.
 */

/** Presence changes in minutes; a snapshot older than this is not shown as current. */
const MAX_AGE_MS = 2 * 60_000;

async function fetchSnapshot(userId: string): Promise<PresenceSnapshot> {
  let json: unknown;
  try {
    ({ json } = await fetchUpstreamJson(lanyardRestUrl(userId), { service: "lanyard", timeoutMs: 3000, retries: 1 }));
  } catch (error) {
    // For this fixed path, Lanyard's only 404 is user_not_monitored.
    if (isUpstreamError(error) && error.kind === "not-found") return { tracked: false, presence: null };
    throw error;
  }
  const body = asRecord(json);
  const problem = body?.success === true ? presenceProblem(body.data) : "success is not true";
  const presence = problem === null ? parseLanyardPresence(body?.data, { kv: site.discord.kv }) : null;
  // The service label carries the field name (never a value) so the owner can see what changed.
  if (!presence) throw new UpstreamError("invalid-response", `lanyard (${problem ?? "unreadable"})`);
  return { tracked: true, presence };
}

export async function loadPresence(): Promise<Loaded<PresenceSnapshot>> {
  const userId = serverEnv.discordUserId;
  if (!userId || !isSnowflake(userId)) return { status: "missing-config", missing: ["DISCORD_USER_ID"] };
  const result = await toLoaded({ key: `lanyard:${userId}`, ttlMs: cacheTtl.presence, load: () => fetchSnapshot(userId) });
  if (result.status === "ok" && result.stale && Date.now() - result.fetchedAt > MAX_AGE_MS) {
    return { status: "unavailable", reason: "upstream", detail: "lanyard: the last snapshot is too old to show" };
  }
  return result;
}

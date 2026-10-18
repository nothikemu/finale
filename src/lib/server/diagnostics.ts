import "server-only";

import type { Loaded } from "@/data/types";
import { hint } from "@/lib/dev-hint";
import { describeFailure } from "@/lib/failure";
import { serverEnv } from "./env";

/**
 * Owner-facing hints (and /status) are for whoever runs the site, never for visitors.
 * They appear when, in this order:
 *   1. the owner turned them off (SHOW_DIAGNOSTICS=0): never;
 *   2. the owner turned them on (SHOW_DIAGNOSTICS=1, or showDiagnostics in src/config/identity.ts);
 *   3. this is a development build (`npm run dev`).
 * A production server never guesses who is looking: request headers such as Host and X-Forwarded-For
 * are chosen by the client, so nothing derived from them may unlock owner information. Hints name
 * settings only; /status adds which settings arrived, so turn it on while debugging and off after.
 */
export type DiagnosticsReason = "SHOW_DIAGNOSTICS" | "development build";

export function diagnosticsReason(): DiagnosticsReason | null {
  const setting = serverEnv.diagnosticsSetting;
  if (setting === false) return null;
  if (setting === true) return "SHOW_DIAGNOSTICS";
  return process.env.NODE_ENV !== "production" ? "development build" : null;
}

export const hintsEnabled = (): boolean => diagnosticsReason() !== null;

/** Owner-facing hint, or undefined for visitors. */
export const ownerHint = (text: string | undefined): string | undefined => hint(text, hintsEnabled());

export const failureHint = (result: Loaded<unknown>): string | undefined => ownerHint(describeFailure(result));

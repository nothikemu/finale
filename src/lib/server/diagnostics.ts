import "server-only";

import type { Loaded } from "@/data/types";
import { hint } from "@/lib/dev-hint";
import { describeFailure } from "@/lib/failure";
import { serverEnv } from "./env";

export const hintsEnabled = (): boolean => process.env.NODE_ENV !== "production" || serverEnv.showDiagnostics;

/** Owner-facing hint, or undefined for visitors. */
export const ownerHint = (text: string | undefined): string | undefined => hint(text, hintsEnabled());

export const failureHint = (result: Loaded<unknown>): string | undefined => ownerHint(describeFailure(result));

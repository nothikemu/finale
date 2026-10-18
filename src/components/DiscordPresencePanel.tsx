import { site } from "@/config/site";
import { isSnowflake } from "@/data/discord/assets";
import { safeHttpsUrl, cleanMultiline } from "@/lib/sanitize";
import { serverEnv, warnOnce } from "@/lib/server/env";
import { DiscordPresence } from "./DiscordPresence";
import { hintsEnabled, ownerHint } from "@/lib/server/diagnostics";

/**
 * Server shell: decides whether presence can be tracked at all. The owner's
 * Discord ID is a public identifier, so it is safe to hand to the client, which
 * talks to Lanyard directly. Nothing is inferred or defaulted when it is absent.
 */
export function DiscordPresencePanel() {
  const userId = serverEnv.discordUserId;
  const bannerUrl = safeHttpsUrl(serverEnv.profileBannerUrl);
  const fallbackBio = cleanMultiline(serverEnv.profileBio, 300);

  if (!userId) {
    warnOnce("discord-id", "DISCORD_USER_ID is not set; the Discord presence panel shows its setup state.");
    return <DiscordShell state="missing-config" hint={ownerHint("set DISCORD_USER_ID (see README)")} bannerUrl={bannerUrl} />;
  }
  if (!isSnowflake(userId)) {
    warnOnce("discord-id-invalid", "DISCORD_USER_ID must be a numeric Discord user ID.");
    return <DiscordShell state="invalid-config" hint={ownerHint("DISCORD_USER_ID must be numeric (see README)")} bannerUrl={bannerUrl} />;
  }
  return <DiscordPresence userId={userId} bannerUrl={bannerUrl} fallbackBio={fallbackBio} kv={site.discord.kv} hints={hintsEnabled()} />;
}

function DiscordShell({ state, hint, bannerUrl }: { state: "missing-config" | "invalid-config"; hint?: string; bannerUrl: string | null }) {
  return (
    <section className="panel panel--discord" aria-labelledby="discord-title" style={{ "--i": 0 } as React.CSSProperties}>
      <div className="discord__banner">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- owner-supplied banner of unknown size/host
          <img src={bannerUrl} alt="" width={420} height={100} decoding="async" referrerPolicy="no-referrer" />
        ) : null}
        <h2 id="discord-title" className="discord__label">
          discord
        </h2>
      </div>
      <div className="discord__setup state" role="status" data-state={state}>
        <p className="state__text">presence not configured</p>
        {hint ? <p className="state__hint">{hint}</p> : null}
      </div>
    </section>
  );
}

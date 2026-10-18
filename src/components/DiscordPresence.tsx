"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getLanyardHandle, INITIAL_LANYARD_STATE } from "@/data/discord/lanyard-store";
import { resolveBanner, resolveBio } from "@/data/discord/profile";
import type { ActivityView, DiscordPresence as Presence, DiscordStatus, SpotifyActivity } from "@/data/discord/types";
import { hint } from "@/lib/dev-hint";
import { formatClock } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Artwork } from "./Artwork";
import { ExternalIcon } from "./icons";

interface Props {
  userId: string;
  /** Owner-configured banner fallback (PROFILE_BANNER_URL). */
  bannerUrl: string | null;
  /** Owner-configured bio fallback (PROFILE_BIO). */
  fallbackBio: string | null;
  /** Owner-approved Lanyard KV keys for bio and banner. */
  kv: { bio: string | null; banner: string | null };
  /** Whether owner-facing hints are shown (development, or SHOW_DIAGNOSTICS=1). */
  hints: boolean;
}

/** Served by this site's own server, for visitors whose network cannot reach Lanyard. */
const FALLBACK_URL = "/api/presence";

/** Lanyard only tracks accounts that joined its Discord server (invite from Lanyard's README). */
const LANYARD_INVITE = "https://discord.gg/UrXF2cfJ7F";

const STATUS_LABEL: Record<DiscordStatus, string> = {
  online: "online",
  idle: "idle",
  dnd: "do not disturb",
  offline: "offline",
};

const ACTIVITY_VERB = {
  playing: "playing",
  streaming: "streaming",
  listening: "listening to",
  watching: "watching",
  competing: "competing in",
} as const;

export function DiscordPresence({ userId, bannerUrl, fallbackBio, kv, hints }: Props) {
  const { bio: kvBioKey, banner: kvBannerKey } = kv;
  const handle = useMemo(() => getLanyardHandle(userId, { kv: { bio: kvBioKey, banner: kvBannerKey }, fallbackUrl: FALLBACK_URL }), [userId, kvBioKey, kvBannerKey]);
  useEffect(() => handle.retain(), [handle]);
  const state = useSyncExternalStore(handle.store.subscribe, handle.store.getSnapshot, () => INITIAL_LANYARD_STATE);

  const { presence } = state;
  // Bio and banner precedence: what Lanyard genuinely returned, then the approved KV key, then the owner's PROFILE_* fallback.
  const bio = resolveBio(presence, fallbackBio);
  const banner = resolveBanner(presence, bannerUrl);
  const hasTimers = Boolean(presence?.spotify?.start || presence?.activities.some((a) => a.start));
  const { now } = useNow(null, 1000, hasTimers);

  return (
    <section className="panel panel--discord" aria-labelledby="discord-title" style={{ "--i": 0 } as React.CSSProperties}>
      <div className="discord__banner">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element -- owner/Discord banner of unknown size
          <img src={banner} alt="" width={420} height={100} decoding="async" referrerPolicy="no-referrer" />
        ) : null}
        <h2 id="discord-title" className="discord__label">
          discord
        </h2>
        <ConnectionTag connection={state.connection} hasPresence={presence !== null} />
      </div>

      {state.notTracked ? (
        <Message text="presence not tracked" hint={hint(`this Discord account is not tracked by Lanyard: join ${LANYARD_INVITE} with it (see README)`, hints)} />
      ) : presence === null ? (
        state.failed ? <Message text="presence unavailable" hint={hint(`${state.detail ?? "no presence arrived from Lanyard"} (see README: troubleshooting)`, hints)} /> : <PresenceSkeleton />
      ) : (
        <>
          <Identity presence={presence} />
          <div className="panel__body scroll discord__body" tabIndex={0} role="region" aria-label="discord profile and activity, scrollable">
            {presence.badges.length > 0 ? (
              <ul className="badges" aria-label="badges">
                {presence.badges.map((badge) => (
                  <li className="tag" key={badge.key}>
                    {badge.label}
                  </li>
                ))}
              </ul>
            ) : null}
            {bio ? <p className="discord__bio">{bio}</p> : null}
            <Activities presence={presence} now={now} />
          </div>
        </>
      )}
    </section>
  );
}

function ConnectionTag({ connection, hasPresence }: { connection: string; hasPresence: boolean }) {
  if (!hasPresence) return null;
  const live = connection === "open";
  return (
    <span className={`discord__connection${live ? "" : " is-stale"}`}>
      <span className="marker" aria-hidden="true" />
      {live ? "live" : connection === "paused" ? "paused" : "stale · reconnecting"}
    </span>
  );
}

function Message({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="discord__setup state" role="status">
      <p className="state__text">{text}</p>
      {hint ? <p className="state__hint">{hint}</p> : null}
    </div>
  );
}

function PresenceSkeleton() {
  return (
    <div className="discord__identity" aria-hidden="true">
      <span className="skeleton__block discord__avatar-skeleton" />
      <div className="skeleton discord__lines">
        <span className="skeleton__block skeleton__line" />
        <span className="skeleton__block skeleton__line skeleton__line--short" />
      </div>
    </div>
  );
}

function StatusMarker({ status }: { status: DiscordStatus }) {
  return <span className={`status-marker status-marker--${status}`} aria-hidden="true" />;
}

function Identity({ presence }: { presence: Presence }) {
  const { user, status, platforms } = presence;
  return (
    <div className="discord__identity">
      <div className="discord__avatar">
        <span className="discord__avatar-frame">
          {/* eslint-disable-next-line @next/next/no-img-element -- Discord CDN avatar at fixed size */}
          <img src={user.avatarUrl} alt={`${user.displayName} profile picture`} width={64} height={64} decoding="async" referrerPolicy="no-referrer" />
        </span>
        <StatusMarker status={status} />
      </div>
      <div className="discord__names">
        <p className="discord__name">{user.displayName}</p>
        <p className="discord__username">@{user.username}</p>
        <p className="discord__status">
          <StatusMarker status={status} />
          <span>{STATUS_LABEL[status]}</span>
          {platforms.length > 0 ? <span className="discord__platforms">· {platforms.join(" / ")}</span> : null}
        </p>
      </div>
    </div>
  );
}

function Activities({ presence, now }: { presence: Presence; now: number | null }) {
  const { customStatus, spotify, activities } = presence;
  const empty = !customStatus && !spotify && activities.length === 0;
  return (
    <div className="activities">
      {customStatus ? (
        <p className="custom-status">
          <span className="visually-hidden">custom status: </span>
          {customStatus.emojiUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Discord custom emoji, fixed size
            <img className="custom-status__emoji" src={customStatus.emojiUrl} alt="" width={16} height={16} referrerPolicy="no-referrer" />
          ) : customStatus.emojiText ? (
            <span className="custom-status__emoji">{customStatus.emojiText}</span>
          ) : null}
          {customStatus.text}
        </p>
      ) : null}
      {spotify ? <SpotifyCard spotify={spotify} now={now} /> : null}
      {activities.map((activity) => (
        <ActivityCard activity={activity} now={now} key={activity.id} />
      ))}
      {empty ? <p className="muted">no current activity</p> : null}
    </div>
  );
}

function elapsed(start: number | null, end: number | null, now: number | null) {
  if (now === null || start === null) return null;
  if (end !== null) {
    const total = end - start;
    const done = Math.min(Math.max(now - start, 0), total);
    return { label: `${formatClock(done)} / ${formatClock(total)}`, ratio: total > 0 ? done / total : 0 };
  }
  return { label: `${formatClock(now - start)} elapsed`, ratio: null };
}

function SpotifyCard({ spotify, now }: { spotify: SpotifyActivity; now: number | null }) {
  const progress = elapsed(spotify.start, spotify.end, now);
  return (
    <article className="activity">
      <Artwork src={spotify.artworkUrl} size={56} />
      <div className="activity__text">
        <p className="activity__kind">listening to spotify</p>
        <p className="activity__title">
          {spotify.trackUrl ? (
            <a href={spotify.trackUrl} target="_blank" rel="noopener noreferrer">
              {spotify.track}
              <span className="track__external" aria-hidden="true">
                <ExternalIcon size={10} />
              </span>
              <span className="visually-hidden"> (opens spotify in a new tab)</span>
            </a>
          ) : (
            spotify.track
          )}
        </p>
        <p className="activity__detail">{spotify.artist}</p>
        {spotify.album ? <p className="activity__detail activity__detail--muted">{spotify.album}</p> : null}
        {progress ? (
          // Ticking text is aria-hidden so it is never announced every second.
          <p className="activity__time" aria-hidden="true">
            {progress.label}
            {progress.ratio !== null ? (
              <span className="progress">
                <span className="progress__fill" style={{ transform: `scaleX(${progress.ratio})` }} />
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function ActivityCard({ activity, now }: { activity: ActivityView; now: number | null }) {
  const progress = elapsed(activity.start, activity.end, now);
  return (
    <article className="activity">
      <Artwork src={activity.imageUrl} size={56} />
      <div className="activity__text">
        <p className="activity__kind">{ACTIVITY_VERB[activity.kind]}</p>
        <p className="activity__title">{activity.name}</p>
        {activity.details ? <p className="activity__detail">{activity.details}</p> : null}
        {activity.state ? <p className="activity__detail activity__detail--muted">{activity.state}</p> : null}
        {progress ? (
          <p className="activity__time" aria-hidden="true">
            {progress.label}
          </p>
        ) : null}
      </div>
    </article>
  );
}

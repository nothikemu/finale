"use client";

import { useEffect, useState } from "react";
import type { Listen, ListeningData, Loaded, Track } from "@/data/types";
import { hint } from "@/lib/dev-hint";
import { describeFailure } from "@/lib/failure";
import { formatExactTimestamp, formatListenTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Artwork } from "./Artwork";
import { StateMessage } from "./Panel";
import { ExternalIcon } from "./icons";

const REFRESH_MS = 30_000;
const RETRY_MS = 60_000;
const STATUSES = ["ok", "missing-config", "unavailable"];

/** Cheap structural check: the API is ours, but a CDN or proxy could still hand back anything. */
function isLoadedListening(value: unknown): value is Loaded<ListeningData> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { status?: unknown; data?: { listens?: unknown } };
  if (typeof record.status !== "string" || !STATUSES.includes(record.status)) return false;
  return record.status !== "ok" || Array.isArray(record.data?.listens);
}

interface Props {
  initial: Loaded<ListeningData>;
  /** Server render time, so relative times match the HTML on first client render. */
  serverNow: number;
  /** Whether owner-facing hints are shown (development, or SHOW_DIAGNOSTICS=1). */
  hints: boolean;
}

export function ListeningFeed({ initial, serverNow, hints }: Props) {
  const [result, setResult] = useState(initial);
  const { now, mounted } = useNow(serverNow, 30_000);

  const configured = initial.status !== "missing-config";
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function refresh() {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      let delay = REFRESH_MS;
      try {
        const response = await fetch("/api/listening", { cache: "no-store", signal: own.signal });
        const json: unknown = await response.json();
        if (cancelled) return;
        if (!isLoadedListening(json)) throw new Error("unexpected response");
        // Never replace good data with a transient failure; keep it and mark it stale.
        setResult((previous) => (json.status !== "ok" && previous.status === "ok" ? { ...previous, stale: true } : json));
        if (json.status !== "ok") delay = RETRY_MS;
      } catch {
        if (cancelled || own.signal.aborted) return;
        setResult((previous) => (previous.status === "ok" ? { ...previous, stale: true } : { status: "unavailable", reason: "network" }));
        delay = RETRY_MS;
      }
      if (!cancelled && !document.hidden) timer = setTimeout(refresh, delay);
    }

    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // The server already rendered fresh data, so wait one interval before the first refresh.
    timer = setTimeout(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [configured]);

  if (result.status === "missing-config") {
    return <StateMessage hint={hint(describeFailure(result), hints)}>listening not configured</StateMessage>;
  }
  if (result.status === "unavailable") {
    return <StateMessage hint={hint(describeFailure(result), hints)}>listening history unavailable</StateMessage>;
  }

  const { nowPlaying, listens } = result.data;
  const zone = mounted ? undefined : "UTC";
  const clock = now ?? serverNow;

  if (!nowPlaying && listens.length === 0) {
    return <StateMessage>no recent listens</StateMessage>;
  }

  return (
    <div className="listening">
      {result.stale ? <p className="stale-note">showing last known data</p> : null}
      {nowPlaying ? (
        <div className="now-playing">
          <p className="now-playing__label">
            <span className="marker" aria-hidden="true" /> now playing
          </p>
          <TrackRow track={nowPlaying} />
        </div>
      ) : null}
      <ol className="tracks">
        {listens.map((listen) => (
          <TrackRow key={listen.id} track={listen} time={{ listen, now: clock, zone }} />
        ))}
      </ol>
    </div>
  );
}

function TrackRow({ track, time }: { track: Track; time?: { listen: Listen; now: number; zone: string | undefined } }) {
  const subtitle = track.album ? `${track.artist} · ${track.album}` : track.artist;
  const Row = time ? "li" : "div";
  return (
    <Row className="track">
      <Artwork src={track.artworkUrl} size={44} />
      <span className="track__text">
        <span className="track__title">
          {track.spotifyUrl ? (
            <a href={track.spotifyUrl} target="_blank" rel="noopener noreferrer">
              {track.title}
              <span className="track__external" aria-hidden="true">
                <ExternalIcon size={10} />
              </span>
              <span className="visually-hidden"> (opens spotify in a new tab)</span>
            </a>
          ) : (
            track.title
          )}
        </span>
        <span className="track__artist">{subtitle}</span>
      </span>
      {time ? (
        <time className="track__time" dateTime={new Date(time.listen.listenedAt).toISOString()} title={formatExactTimestamp(time.listen.listenedAt, time.zone)}>
          {formatListenTime(time.listen.listenedAt, time.now, time.zone)}
          <span className="visually-hidden">, {formatExactTimestamp(time.listen.listenedAt, time.zone)}</span>
        </time>
      ) : null}
    </Row>
  );
}

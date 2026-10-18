"use client";

import { useEffect, useState } from "react";

/**
 * A clock that is safe for server-rendered text.
 *
 * `serverNow` is the timestamp the server rendered with, so the first client
 * render matches the HTML. After mount the value follows Date.now() every
 * `intervalMs`, pausing while the tab is hidden. `mounted` flips to true once
 * hydration is done, which is when it becomes safe to use the visitor's time zone.
 */
export function useNow(serverNow: number | null, intervalMs: number, enabled = true): { now: number | null; mounted: boolean } {
  const [now, setNow] = useState<number | null>(serverNow);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydration finished: from here on client-only values are allowed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      stop();
      if (!document.hidden) start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);

  return { now, mounted };
}

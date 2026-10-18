import { asRecord, asFiniteNumber } from "@/lib/guards";
import { isPresenceView, parseLanyardPresence, presenceProblem, type KvKeys } from "./parse";
import type { DiscordPresence } from "./types";

/**
 * One shared Lanyard subscription.
 *
 * Protocol (https://github.com/Phineas/lanyard):
 *   1. connect to wss://api.lanyard.rest/socket
 *   2. receive op 1 "Hello" carrying heartbeat_interval
 *   3. send op 2 { subscribe_to_id } and start sending op 3 heartbeats
 *   4. receive op 0 events: INIT_STATE, then PRESENCE_UPDATE
 *
 * The REST endpoint is fetched once alongside the socket so first paint does
 * not depend on the socket, and so "user is not tracked by Lanyard" can be told
 * apart from "Lanyard is unreachable".
 *
 * If the browser cannot get presence from Lanyard (an ad blocker, a VPN, a
 * firewall), the store asks this site's own server instead (`fallbackUrl`),
 * which reads the same REST endpoint. It keeps asking while the socket is not
 * live, so the panel still shows real data, labelled as not live.
 */

export const LANYARD_SOCKET_URL = "wss://api.lanyard.rest/socket";
export const lanyardRestUrl = (userId: string) => `https://api.lanyard.rest/v1/users/${userId}`;

export type Connection = "connecting" | "open" | "reconnecting" | "paused";

export interface LanyardState {
  presence: DiscordPresence | null;
  connection: Connection;
  /** No presence could be obtained (and Lanyard did not say the user is untracked). */
  failed: boolean;
  /** Lanyard says this user is not being monitored. */
  notTracked: boolean;
  /** When `failed`: what went wrong, for owner diagnostics. Never contains credentials. */
  detail: string | null;
  /** Unix ms of the last presence we accepted. */
  updatedAt: number | null;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface LanyardDeps {
  createSocket(url: string): SocketLike;
  fetch: typeof fetch;
  now(): number;
  random(): number;
  isHidden(): boolean;
  onVisibilityChange(listener: () => void): () => void;
}

export interface LanyardOptions {
  /** Owner-approved Lanyard KV keys to read (bio, banner). */
  kv?: KvKeys;
  /** Same-origin URL answering with the server's own snapshot of the presence (see /api/presence). */
  fallbackUrl?: string;
  deps?: Partial<LanyardDeps>;
}

const SOCKET_OPEN = 1;
const DEFAULT_HEARTBEAT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** Close the socket after this long hidden; a backgrounded tab cannot heartbeat reliably anyway. */
const HIDDEN_CLOSE_MS = 60_000;
const REST_TIMEOUT_MS = 8_000;
/** While the socket is not live, refresh from the server this often. */
const FALLBACK_POLL_MS = 30_000;

export interface LanyardStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LanyardState;
  start(): void;
  stop(): void;
}

/** Equal-jitter exponential backoff: half fixed, half random. */
export function backoffDelay(attempt: number, random: number): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return cap / 2 + random * (cap / 2);
}

function defaultDeps(): LanyardDeps {
  return {
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    random: () => Math.random(),
    isHidden: () => typeof document !== "undefined" && document.hidden,
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export function createLanyardStore(userId: string, options: LanyardOptions = {}): LanyardStore {
  const deps: LanyardDeps = { ...defaultDeps(), ...options.deps };
  const listeners = new Set<() => void>();
  let state = INITIAL_LANYARD_STATE;

  let running = false;
  let socket: SocketLike | null = null;
  let attempt = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  let removeVisibility: (() => void) | undefined;
  let restController: AbortController | undefined;
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  let restDone = false;
  /** Why the browser's own REST request produced nothing, if it did not. */
  let restIssue: string | null = null;
  let fallbackController: AbortController | undefined;
  let fallbackPoll: ReturnType<typeof setInterval> | undefined;
  let fallbackInflight = false;
  let fallbackTried = false;
  let serverIssue: string | null = null;
  /** Counts start() calls, so a request from a stopped run cannot write into the next one. */
  let run = 0;

  function set(patch: Partial<LanyardState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function acceptPresence(raw: unknown) {
    const presence = parseLanyardPresence(raw, { kv: options.kv });
    // The socket is a shared service: ignore anyone else's presence, however it got here.
    if (!presence || presence.user.id !== userId) return false;
    set({ presence, updatedAt: deps.now(), failed: false, notTracked: false, detail: null });
    return true;
  }

  const nothingToShow = () => state.presence === null && !state.notTracked;

  function describeFailure(): string {
    const browser = restIssue ?? "no presence arrived over the socket from api.lanyard.rest";
    return serverIssue ? `${browser}; the dashboard's server could not get it either (${serverIssue})` : browser;
  }

  /**
   * The panel is still empty. Ask this site's server once before admitting
   * failure (when a fallback exists); afterwards report the real reason.
   */
  function giveUp() {
    if (!running || !nothingToShow() || fallbackInflight) return;
    if (options.fallbackUrl && !fallbackTried) {
      void fetchFallback();
      return;
    }
    set({ failed: true, detail: describeFailure() });
  }

  function stopHeartbeat() {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function detachSocket() {
    stopHeartbeat();
    const current = socket;
    socket = null;
    if (current) {
      current.onopen = current.onmessage = current.onclose = current.onerror = null;
      try {
        current.close(1000);
      } catch {
        // Already closed.
      }
    }
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer !== undefined) return;
    set({ connection: "reconnecting" });
    const delay = backoffDelay(attempt, deps.random());
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const frame = asRecord(message);
    if (!frame) return;

    if (frame.op === 1) {
      const interval = asFiniteNumber(asRecord(frame.d)?.heartbeat_interval);
      const everyMs = interval !== null && interval >= 1000 ? interval : DEFAULT_HEARTBEAT_MS;
      attempt = 0; // The handshake worked; the next failure starts from a short delay.
      socket?.send(JSON.stringify({ op: 2, d: { subscribe_to_id: userId } }));
      stopHeartbeat();
      heartbeat = setInterval(() => {
        if (socket && socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ op: 3 }));
      }, everyMs);
      set({ connection: "open" });
      return;
    }
    if (frame.op === 0 && (frame.t === "INIT_STATE" || frame.t === "PRESENCE_UPDATE")) {
      // A single subscription sends the presence itself; a multi-user reply keys it by ID. Accept both.
      if (!acceptPresence(frame.d)) acceptPresence(asRecord(frame.d)?.[userId]);
    }
  }

  function connect() {
    if (!running) return;
    detachSocket();
    set({ connection: attempt === 0 && state.presence === null ? "connecting" : "reconnecting" });
    let created: SocketLike;
    try {
      created = deps.createSocket(LANYARD_SOCKET_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = created;
    created.onmessage = (event) => handleMessage(event.data);
    created.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
    created.onclose = () => {
      if (socket !== created) return;
      detachSocket();
      if (restDone) giveUp();
      scheduleReconnect();
    };
  }

  async function fetchRest() {
    restController?.abort();
    clearTimeout(restTimer);
    const controller = new AbortController();
    restController = controller;
    let timedOut = false;
    restTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REST_TIMEOUT_MS);
    restIssue = null;
    const mine = run;
    try {
      const response = await deps.fetch(lanyardRestUrl(userId), { signal: controller.signal, cache: "no-store" });
      const body = asRecord(await response.json().catch(() => null));
      if (!running || controller.signal.aborted) return;
      if (response.ok && body?.success === true) {
        // The socket may have delivered fresher data while this was in flight.
        if (state.presence === null && !acceptPresence(body.data)) {
          restIssue = `api.lanyard.rest sent a presence this site cannot read (${presenceProblem(body.data) ?? "unreadable"})`;
        }
      } else if (asRecord(body?.error)?.code === "user_not_monitored") {
        set({ notTracked: true, failed: false, detail: null });
      } else if (body === null) {
        restIssue = `api.lanyard.rest answered HTTP ${response.status} but not with JSON (a proxy or captive portal in the way?)`;
      } else {
        restIssue = `api.lanyard.rest answered HTTP ${response.status}`;
      }
    } catch {
      // A deliberate abort (restart or stop) is not a failure; a timeout or network error is.
      if (running && restController === controller) {
        restIssue = timedOut ? "api.lanyard.rest did not answer in time" : "the browser could not reach api.lanyard.rest (blocked by an extension or firewall, or offline)";
      }
    } finally {
      if (restController === controller) clearTimeout(restTimer);
      if (mine !== run) return;
      restDone = true;
      if (running && nothingToShow()) {
        // With the socket still connecting, wait for it; but a failed REST call is reason enough to ask the server.
        if (socket === null) giveUp();
        else if (restIssue !== null && options.fallbackUrl && !fallbackTried) giveUp();
      }
    }
  }

  /** Our own server's view of the presence: slower to update, but it does not depend on the visitor's network. */
  async function fetchFallback() {
    const url = options.fallbackUrl;
    if (!url || !running || fallbackInflight) return;
    fallbackInflight = true;
    fallbackController?.abort();
    const controller = new AbortController();
    fallbackController = controller;
    const mine = run;
    const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
    try {
      const response = await deps.fetch(url, { signal: controller.signal, cache: "no-store" });
      const body = asRecord(await response.json().catch(() => null));
      if (!running || controller.signal.aborted) return;
      const data = asRecord(body?.data);
      if (body?.status === "ok" && data?.tracked === false) {
        serverIssue = null;
        if (state.presence === null) set({ notTracked: true, failed: false, detail: null });
      } else if (body?.status === "ok" && isPresenceView(data?.presence)) {
        serverIssue = null;
        // Live data is fresher than any snapshot, so it is only replaced while the socket is not
        // open; but a socket that is "open" yet has delivered nothing must not leave the panel empty.
        if (state.connection !== "open" || state.presence === null) set({ presence: data.presence, updatedAt: deps.now(), failed: false, notTracked: false, detail: null });
      } else if (body?.status === "unavailable") {
        serverIssue = typeof body.detail === "string" ? body.detail.slice(0, 160) : "unavailable";
      } else if (body?.status === "missing-config") {
        serverIssue = "DISCORD_USER_ID is not set on the server";
      } else {
        serverIssue = `the dashboard's server sent an unexpected answer (HTTP ${response.status})`;
      }
    } catch {
      if (running && fallbackController === controller) serverIssue = "the dashboard's own server did not answer";
    } finally {
      clearTimeout(timer);
      if (mine === run) {
        fallbackInflight = false;
        fallbackTried = true;
        giveUp();
      }
    }
  }

  function onVisibility() {
    if (!running) return;
    if (deps.isHidden()) {
      hiddenTimer ??= setTimeout(() => {
        hiddenTimer = undefined;
        if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        detachSocket();
        set({ connection: "paused" });
      }, HIDDEN_CLOSE_MS);
      return;
    }
    if (hiddenTimer !== undefined) {
      clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
    }
    if (state.connection === "paused") {
      attempt = 0;
      connect();
      void fetchRest();
      if (options.fallbackUrl) void fetchFallback();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    start() {
      if (running) return;
      running = true;
      run += 1;
      restDone = false;
      restIssue = serverIssue = null;
      fallbackTried = false;
      fallbackInflight = false;
      attempt = 0;
      state = INITIAL_LANYARD_STATE;
      removeVisibility = deps.onVisibilityChange(onVisibility);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        giveUp();
      }, SETTLE_TIMEOUT_MS);
      if (options.fallbackUrl) {
        fallbackPoll = setInterval(() => {
          if (state.connection !== "open" && !deps.isHidden()) void fetchFallback();
        }, FALLBACK_POLL_MS);
      }
      connect();
      void fetchRest();
    },
    stop() {
      running = false;
      restController?.abort();
      fallbackController?.abort();
      fallbackInflight = false;
      if (fallbackPoll !== undefined) clearInterval(fallbackPoll);
      fallbackPoll = undefined;
      for (const timer of [reconnectTimer, settleTimer, hiddenTimer, restTimer]) if (timer !== undefined) clearTimeout(timer);
      reconnectTimer = settleTimer = hiddenTimer = restTimer = undefined;
      removeVisibility?.();
      removeVisibility = undefined;
      detachSocket();
    },
  };
}

export const INITIAL_LANYARD_STATE: LanyardState = {
  presence: null,
  connection: "connecting",
  failed: false,
  notTracked: false,
  detail: null,
  updatedAt: null,
};

export interface LanyardHandle {
  store: LanyardStore;
  /** Starts the connection if this is the first holder. Returns the release function. */
  retain(): () => void;
}

const shared = new Map<string, { handle: LanyardHandle }>();

/**
 * Ref-counted so every component asking for the same user shares one socket.
 * The store is started by the first retain() and stopped by the last release().
 */
export function getLanyardHandle(userId: string, options: LanyardOptions = {}): LanyardHandle {
  const key = `${userId}|${options.kv?.bio ?? ""}|${options.kv?.banner ?? ""}|${options.fallbackUrl ?? ""}`;
  const existing = shared.get(key);
  if (existing) return existing.handle;

  const store = createLanyardStore(userId, options);
  let holders = 0;
  const handle: LanyardHandle = {
    store,
    retain() {
      holders += 1;
      if (holders === 1) store.start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) store.stop();
      };
    },
  };
  shared.set(key, { handle });
  return handle;
}

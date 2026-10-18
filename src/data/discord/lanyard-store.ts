import { asRecord, asFiniteNumber } from "@/lib/guards";
import { parseLanyardPresence, type KvKeys } from "./parse";
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

  function set(patch: Partial<LanyardState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function acceptPresence(raw: unknown) {
    const presence = parseLanyardPresence(raw, { kv: options.kv });
    if (!presence) return false;
    set({ presence, updatedAt: deps.now(), failed: false, notTracked: false });
    return true;
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
      acceptPresence(frame.d);
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
      markFailedIfNothingToShow();
      scheduleReconnect();
    };
  }

  function markFailedIfNothingToShow() {
    if (state.presence === null && !state.notTracked && restDone) set({ failed: true });
  }

  async function fetchRest() {
    restController?.abort();
    clearTimeout(restTimer);
    const controller = new AbortController();
    restController = controller;
    restTimer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
    try {
      const response = await deps.fetch(lanyardRestUrl(userId), { signal: controller.signal, cache: "no-store" });
      const body = asRecord(await response.json().catch(() => null));
      if (!running || controller.signal.aborted) return;
      if (response.ok && body?.success === true) {
        // The socket may have delivered fresher data while this was in flight.
        if (state.presence === null) acceptPresence(body.data);
      } else if (asRecord(body?.error)?.code === "user_not_monitored") {
        set({ notTracked: true, failed: false });
      }
    } catch {
      // Treated as unavailable below if the socket cannot supply data either.
    } finally {
      if (restController === controller) clearTimeout(restTimer);
      restDone = true;
      if (running && socket === null) markFailedIfNothingToShow();
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
      restDone = false;
      attempt = 0;
      state = INITIAL_LANYARD_STATE;
      removeVisibility = deps.onVisibilityChange(onVisibility);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        if (state.presence === null && !state.notTracked) set({ failed: true });
      }, SETTLE_TIMEOUT_MS);
      connect();
      void fetchRest();
    },
    stop() {
      running = false;
      restController?.abort();
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
  const key = `${userId}|${options.kv?.bio ?? ""}|${options.kv?.banner ?? ""}`;
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

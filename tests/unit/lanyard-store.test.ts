import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createLanyardStore, getLanyardHandle, type SocketLike } from "@/data/discord/lanyard-store";
import { parseLanyardPresence } from "@/data/discord/parse";

const ID = "100000000000000001";

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | undefined;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const presenceData = (status = "online") => ({
  discord_status: status,
  discord_user: { id: ID, username: "tester", discriminator: "0" },
  activities: [],
});

let hidden = false;
let visibilityListener: (() => void) | undefined;

function makeStore(rest: () => Promise<Response>) {
  return createLanyardStore(ID, {
    deps: {
      createSocket: (url) => new FakeSocket(url),
      fetch: vi.fn(rest) as unknown as typeof fetch,
      random: () => 0.5,
      isHidden: () => hidden,
      onVisibilityChange: (listener) => {
        visibilityListener = listener;
        return () => {
          visibilityListener = undefined;
        };
      },
    },
  });
}

const restOk = () => Promise.resolve(new Response(JSON.stringify({ success: true, data: presenceData("idle") }), { status: 200 }));
const restDown = () => Promise.reject(new TypeError("network"));
const restUntracked = () =>
  Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: "user_not_monitored" } }), { status: 404 }));

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  hidden = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lanyard store", () => {
  it("performs the documented handshake and heartbeats at the advertised interval", async () => {
    const store = makeStore(restDown);
    store.start();
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("wss://api.lanyard.rest/socket");

    socket.open();
    socket.emit({ op: 1, d: { heartbeat_interval: 5000 } });
    expect(socket.sent).toEqual([{ op: 2, d: { subscribe_to_id: ID } }]);
    expect(store.getSnapshot().connection).toBe("open");

    vi.advanceTimersByTime(15_000);
    expect(socket.sent.filter((frame) => (frame as { op: number }).op === 3)).toHaveLength(3);

    socket.emit({ op: 0, t: "INIT_STATE", d: presenceData("online") });
    expect(store.getSnapshot().presence?.status).toBe("online");
    socket.emit({ op: 0, t: "PRESENCE_UPDATE", d: presenceData("dnd") });
    expect(store.getSnapshot().presence?.status).toBe("dnd");
    store.stop();
  });

  it("accepts a presence keyed by user ID, as a multi-user reply sends it", async () => {
    const store = makeStore(restDown);
    store.start();
    const socket = FakeSocket.instances[0]!;
    socket.emit({ op: 0, t: "INIT_STATE", d: { [ID]: presenceData("idle") } });
    expect(store.getSnapshot().presence?.status).toBe("idle");
    // a key for some other user must not be mistaken for ours
    socket.emit({ op: 0, t: "PRESENCE_UPDATE", d: { "999999999999999999": presenceData("dnd") } });
    expect(store.getSnapshot().presence?.status).toBe("idle");
    store.stop();
  });

  it("ignores malformed frames and invalid presence payloads", async () => {
    const store = makeStore(restDown);
    store.start();
    const socket = FakeSocket.instances[0]!;
    socket.onmessage?.({ data: "not json" });
    socket.emit({ op: 0, t: "PRESENCE_UPDATE", d: { discord_status: "online" } });
    expect(store.getSnapshot().presence).toBeNull();
    store.stop();
  });

  it("uses REST for first paint and does not let it overwrite fresher socket data", async () => {
    const store = makeStore(restOk);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().presence?.status).toBe("idle");
    store.stop();

    const second = makeStore(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return restOk();
    });
    second.start();
    FakeSocket.instances.at(-1)!.emit({ op: 0, t: "INIT_STATE", d: presenceData("dnd") });
    await vi.advanceTimersByTimeAsync(200);
    expect(second.getSnapshot().presence?.status).toBe("dnd");
    second.stop();
  });

  it("reconnects with jittered exponential backoff and keeps the last presence meanwhile", async () => {
    const store = makeStore(restDown);
    store.start();
    const first = FakeSocket.instances[0]!;
    first.open();
    first.emit({ op: 1, d: { heartbeat_interval: 30_000 } });
    first.emit({ op: 0, t: "INIT_STATE", d: presenceData() });

    first.drop();
    expect(store.getSnapshot()).toMatchObject({ connection: "reconnecting", failed: false });
    expect(store.getSnapshot().presence).not.toBeNull();
    expect(FakeSocket.instances).toHaveLength(1);

    // attempt 0 => cap 1000ms, random 0.5 => 750ms
    vi.advanceTimersByTime(749);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(FakeSocket.instances).toHaveLength(2);

    // Failing before the handshake grows the delay: attempt 1 => cap 2000 => 1500ms
    FakeSocket.instances[1]!.drop();
    vi.advanceTimersByTime(1499);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(2);
    expect(FakeSocket.instances).toHaveLength(3);
    store.stop();
  });

  it("caps the backoff and always jitters within [cap/2, cap]", () => {
    expect(backoffDelay(0, 0)).toBe(500);
    expect(backoffDelay(0, 1)).toBe(1000);
    expect(backoffDelay(20, 1)).toBe(60_000);
    expect(backoffDelay(20, 0)).toBe(30_000);
  });

  it("distinguishes untracked and unreachable from offline", async () => {
    const untracked = makeStore(restUntracked);
    untracked.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(untracked.getSnapshot()).toMatchObject({ notTracked: true, failed: false, presence: null });
    untracked.stop();

    const down = makeStore(restDown);
    down.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(down.getSnapshot()).toMatchObject({ failed: true, notTracked: false, presence: null });
    down.stop();
  });

  it("cleans up: stop closes the socket and cancels every timer", async () => {
    const store = makeStore(restDown);
    store.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ op: 1, d: { heartbeat_interval: 1000 } });
    store.stop();
    expect(socket.closedWith).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(visibilityListener).toBeUndefined();
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("closes after a minute hidden and reconnects when visible again", async () => {
    const store = makeStore(restOk);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ op: 1, d: { heartbeat_interval: 30_000 } });

    hidden = true;
    visibilityListener?.();
    vi.advanceTimersByTime(59_000);
    expect(store.getSnapshot().connection).toBe("open");
    vi.advanceTimersByTime(2_000);
    expect(store.getSnapshot().connection).toBe("paused");
    expect(socket.closedWith).toBe(1000);

    hidden = false;
    visibilityListener?.();
    expect(FakeSocket.instances).toHaveLength(2);
    store.stop();
  });

  it("shares one store per user across holders and stops it with the last release", () => {
    const options = { deps: { createSocket: (url: string) => new FakeSocket(url), fetch: vi.fn(restDown) as unknown as typeof fetch, onVisibilityChange: () => () => undefined } };
    const a = getLanyardHandle(ID, options);
    const b = getLanyardHandle(ID, options);
    expect(a).toBe(b);
    const releaseA = a.retain();
    const releaseB = b.retain();
    expect(FakeSocket.instances).toHaveLength(1);
    releaseA();
    releaseA(); // idempotent
    expect(FakeSocket.instances[0]!.closedWith).toBeUndefined();
    releaseB();
    expect(FakeSocket.instances[0]!.closedWith).toBe(1000);
  });
});

describe("lanyard store with the server fallback", () => {
  const FALLBACK = "/api/presence";
  const view = (status = "dnd") => parseLanyardPresence({ ...presenceData(status), discord_status: status })!;
  const fromServer = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const snapshotOk = (status = "dnd") => fromServer({ status: "ok", data: { tracked: true, presence: view(status) }, fetchedAt: 1, stale: false });

  function makeFallbackStore(rest: () => Promise<Response>, fallback: () => Promise<Response>) {
    const calls: string[] = [];
    const fetchFn = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url === FALLBACK ? fallback() : rest();
    });
    const store = createLanyardStore(ID, {
      fallbackUrl: FALLBACK,
      deps: {
        createSocket: (url) => new FakeSocket(url),
        fetch: fetchFn as unknown as typeof fetch,
        random: () => 0.5,
        isHidden: () => hidden,
        onVisibilityChange: (listener) => {
          visibilityListener = listener;
          return () => {
            visibilityListener = undefined;
          };
        },
      },
    });
    return { store, calls };
  }

  it("asks the server as soon as the browser cannot reach Lanyard, and shows what it knows", async () => {
    const { store, calls } = makeFallbackStore(restDown, snapshotOk("dnd"));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([expect.stringContaining("api.lanyard.rest"), FALLBACK]);
    expect(store.getSnapshot()).toMatchObject({ failed: false, notTracked: false, detail: null });
    expect(store.getSnapshot().presence?.status).toBe("dnd");
    // The socket never delivered, so this is honestly not live.
    expect(store.getSnapshot().connection).not.toBe("open");
    store.stop();
  });

  it("reports both causes when neither the browser nor the server can get presence", async () => {
    const { store } = makeFallbackStore(restDown, fromServer({ status: "unavailable", reason: "network", detail: "lanyard: network" }, 502));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = store.getSnapshot();
    expect(snapshot).toMatchObject({ failed: true, presence: null });
    expect(snapshot.detail).toContain("the browser could not reach api.lanyard.rest");
    expect(snapshot.detail).toContain("lanyard: network");
    store.stop();
  });

  it("trusts the server when it says the account is not tracked", async () => {
    const { store } = makeFallbackStore(restDown, fromServer({ status: "ok", data: { tracked: false, presence: null }, fetchedAt: 1, stale: false }));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ notTracked: true, failed: false, presence: null });
    store.stop();
  });

  it("rejects a snapshot that is not shaped like a presence", async () => {
    const { store } = makeFallbackStore(restDown, fromServer({ status: "ok", data: { tracked: true, presence: { user: {} } } }));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ failed: true, presence: null });
    expect(store.getSnapshot().detail).toContain("unexpected answer");
    store.stop();
  });

  it("names what is wrong with an answer it cannot read", async () => {
    const unreadable = () => Promise.resolve(new Response(JSON.stringify({ success: true, data: { discord_status: "online" } }), { status: 200 }));
    const { store } = makeFallbackStore(unreadable, fromServer({ status: "unavailable", detail: "lanyard (discord_user is missing): invalid-response" }, 502));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().failed).toBe(true);
    expect(store.getSnapshot().detail).toContain("discord_user is missing");
    store.stop();

    // Without a fallback the same cause is still reported, once the panel gives up.
    const alone = makeStore(unreadable);
    alone.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(alone.getSnapshot()).toMatchObject({ failed: true });
    expect(alone.getSnapshot().detail).toContain("discord_user is missing");
    alone.stop();
  });

  it("does not use the server while the browser has what it needs", async () => {
    const { store, calls } = makeFallbackStore(restOk, snapshotOk("dnd"));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ op: 1, d: { heartbeat_interval: 30_000 } });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).not.toContain(FALLBACK);
    expect(store.getSnapshot().presence?.status).toBe("idle");
    store.stop();
  });

  it("keeps refreshing from the server while the socket is not live, and stops when it is", async () => {
    let served = "dnd";
    const { store, calls } = makeFallbackStore(restOk, () => snapshotOk(served)());
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().presence?.status).toBe("idle"); // REST first paint
    expect(calls).not.toContain(FALLBACK);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.filter((url) => url === FALLBACK)).toHaveLength(1);
    expect(store.getSnapshot().presence?.status).toBe("dnd");

    served = "online";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.getSnapshot().presence?.status).toBe("online");

    // Once the socket delivers, the live data wins and the server is left alone.
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ op: 1, d: { heartbeat_interval: 30_000 } });
    socket.emit({ op: 0, t: "INIT_STATE", d: presenceData("idle") });
    const before = calls.length;
    served = "offline";
    await vi.advanceTimersByTimeAsync(90_000);
    expect(calls).toHaveLength(before);
    expect(store.getSnapshot().presence?.status).toBe("idle");
    store.stop();
  });

  it("recovers from a failed state when the server later has presence", async () => {
    let answer = fromServer({ status: "unavailable", detail: "lanyard: network" }, 502);
    const { store } = makeFallbackStore(restDown, () => answer());
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().failed).toBe(true);
    answer = snapshotOk("online");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.getSnapshot()).toMatchObject({ failed: false, detail: null });
    expect(store.getSnapshot().presence?.status).toBe("online");
    store.stop();
  });

  it("cleans up the fallback poll when stopped", async () => {
    const { store } = makeFallbackStore(restOk, snapshotOk());
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    store.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

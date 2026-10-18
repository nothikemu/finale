import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createLanyardStore, getLanyardHandle, type SocketLike } from "@/data/discord/lanyard-store";

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

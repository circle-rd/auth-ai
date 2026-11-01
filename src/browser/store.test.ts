import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthAiError, ERR } from "../errors.js";
import {
  INITIAL_AUTH_STATE,
  createAuthStore,
  createObservable,
  createResourceStore,
} from "./store.js";

const user = { sub: "u1", roles: [], permissions: [], features: {} };

describe("createObservable", () => {
  it("notifies subscribers of a change only", () => {
    const value = createObservable(1);
    const listener = vi.fn();
    const stop = value.subscribe(listener);
    value.set(1);
    expect(listener).not.toHaveBeenCalled();
    value.set(2);
    expect(listener).toHaveBeenCalledOnce();
    expect(value.get()).toBe(2);
    stop();
    value.set(3);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("createAuthStore", () => {
  it("starts loading, then reflects the session", async () => {
    const store = createAuthStore({ getUser: async () => user });
    expect(store.state.get()).toBe(INITIAL_AUTH_STATE);
    await store.refresh();
    expect(store.state.get()).toEqual({
      status: "authenticated",
      user,
      error: null,
    });
  });

  it("reports a signed-out user", async () => {
    const store = createAuthStore({ getUser: async () => null });
    await store.refresh();
    expect(store.state.get()).toEqual({
      status: "unauthenticated",
      user: null,
      error: null,
    });
  });

  it("keeps the last user when a refresh fails", async () => {
    const getUser = vi
      .fn<() => Promise<typeof user | null>>()
      .mockResolvedValueOnce(user);
    const store = createAuthStore({ getUser });
    await store.refresh();
    getUser.mockRejectedValueOnce(ERR.OIDC_003());
    await store.refresh();
    expect(store.state.get()).toMatchObject({ status: "error", user });
    expect(store.state.get().error?.code).toBe("OIDC_003");
  });

  it("wraps a foreign failure", async () => {
    const store = createAuthStore({
      getUser: () => Promise.reject(new TypeError("fetch failed")),
    });
    await store.refresh();
    expect(store.state.get().error).toBeInstanceOf(AuthAiError);
    expect(store.state.get().error?.code).toBe("API_001");
  });

  it("ignores a slow answer overtaken by a newer one", async () => {
    const answers = [
      Promise.withResolvers<typeof user | null>(),
      Promise.withResolvers<typeof user | null>(),
    ];
    let call = 0;
    const store = createAuthStore({ getUser: () => answers[call++]!.promise });
    const first = store.refresh();
    const second = store.refresh();
    answers[1]!.resolve(null);
    await second;
    answers[0]!.resolve(user);
    await first;
    expect(store.state.get().status).toBe("unauthenticated");
  });
});

describe("createResourceStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes idle, loading, ready and keeps data while reloading", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("a");
    const store = createResourceStore(load);
    expect(store.state.get().status).toBe("idle");
    await store.refresh();
    expect(store.state.get()).toEqual({
      status: "ready",
      data: "a",
      error: null,
    });

    const pending = Promise.withResolvers<string>();
    load.mockReturnValueOnce(pending.promise);
    const reload = store.refresh();
    expect(store.state.get()).toEqual({
      status: "loading",
      data: "a",
      error: null,
    });
    pending.resolve("b");
    await reload;
    expect(store.state.get().data).toBe("b");
  });

  it("keeps the previous data on error and reports it", async () => {
    const onError = vi.fn();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("a");
    const store = createResourceStore(load, { onError });
    await store.refresh();
    load.mockRejectedValueOnce(ERR.SES_001());
    await store.refresh();
    expect(store.state.get()).toMatchObject({ status: "error", data: "a" });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SES_001" }),
    );
  });

  it("polls until stopped, and a load in flight at stop time writes nothing", async () => {
    const load = vi.fn<() => Promise<number>>().mockResolvedValue(1);
    const store = createResourceStore(load, { pollIntervalMs: 1000 });
    const stop = store.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(load).toHaveBeenCalledTimes(3);

    const pending = Promise.withResolvers<number>();
    load.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    pending.resolve(99);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.state.get().data).toBe(1);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("loads once without a poll interval", async () => {
    const load = vi.fn<() => Promise<number>>().mockResolvedValue(1);
    const stop = createResourceStore(load).start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledOnce();
    stop();
  });
});

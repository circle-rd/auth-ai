import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthAiError } from "./errors.js";
import { ERR } from "./errors.js";
import {
  GrantManager,
  InProcessGrantLock,
  MemoryGrantStore,
} from "./grants.js";
import type { TokenSet } from "./types.js";

const NOW_MS = Date.UTC(2026, 9, 31, 8, 0, 0);

function tokenSet(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: "access",
    tokenType: "Bearer",
    expiresAt: Math.floor(NOW_MS / 1000) + 3600,
    refreshToken: "rotated",
    ...overrides,
  };
}

function oauthError(oauthError: string): AuthAiError {
  return ERR.OIDC_003("rejected", { details: { oauthError } });
}

function setup() {
  const refresh =
    vi.fn<
      (token: string, options?: { resource?: string }) => Promise<TokenSet>
    >();
  const revoke = vi.fn<(token: string, hint?: string) => Promise<void>>(
    async () => undefined,
  );
  const store = new MemoryGrantStore();
  const manager = new GrantManager({
    auth: { refresh, revoke } as never,
    store,
  });
  return { refresh, revoke, store, manager };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GrantManager.getAccessToken", () => {
  it("refreshes for one resource and persists the rotated token", async () => {
    const { refresh, store, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockResolvedValue(tokenSet({ accessToken: "llm-token" }));

    const token = await manager.getAccessToken("u1", {
      resource: "https://llm.test",
    });

    expect(token.accessToken).toBe("llm-token");
    expect(refresh).toHaveBeenCalledWith("refresh-0", {
      resource: "https://llm.test",
    });
    expect(await store.get("u1")).toBe("rotated");
  });

  it("keeps the stored token when the provider does not rotate", async () => {
    const { refresh, store, manager } = setup();
    await manager.save("u1", "refresh-0");
    const { refreshToken: _omitted, ...withoutRotation } = tokenSet();
    refresh.mockResolvedValue(withoutRotation);

    await manager.getAccessToken("u1");

    expect(await store.get("u1")).toBe("refresh-0");
  });

  it("caches per resource until shortly before expiry", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockImplementation(async (_token, options) =>
      tokenSet({ accessToken: options?.resource ?? "default" }),
    );

    await manager.getAccessToken("u1", { resource: "a" });
    await manager.getAccessToken("u1", { resource: "a" });
    expect(refresh).toHaveBeenCalledTimes(1);

    const other = await manager.getAccessToken("u1", { resource: "b" });
    expect(other.accessToken).toBe("b");
    expect(refresh).toHaveBeenCalledTimes(2);

    vi.setSystemTime(NOW_MS + (3600 - 29) * 1000);
    await manager.getAccessToken("u1", { resource: "a" });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("serialises concurrent callers into a single refresh", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockImplementation(async () => {
      await Promise.resolve();
      return tokenSet();
    });

    const tokens = await Promise.all([
      manager.getAccessToken("u1"),
      manager.getAccessToken("u1"),
      manager.getAccessToken("u1"),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(tokens.map((t) => t.accessToken)).size).toBe(1);
  });

  it("chains rotations: each refresh presents the latest token", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh
      .mockResolvedValueOnce(tokenSet({ refreshToken: "refresh-1" }))
      .mockResolvedValueOnce(tokenSet({ refreshToken: "refresh-2" }));

    await Promise.all([
      manager.getAccessToken("u1", { resource: "a" }),
      manager.getAccessToken("u1", { resource: "b" }),
    ]);

    expect(refresh.mock.calls.map(([token]) => token)).toEqual([
      "refresh-0",
      "refresh-1",
    ]);
  });

  it("requires a sign-in when no grant exists", async () => {
    const { refresh, manager } = setup();
    await expect(manager.getAccessToken("ghost")).rejects.toMatchObject({
      code: "TOK_002",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("drops the grant when the provider rejects it", async () => {
    const { refresh, store, manager } = setup();
    await manager.save("u1", "stale");
    refresh.mockRejectedValue(oauthError("invalid_grant"));

    await expect(manager.getAccessToken("u1")).rejects.toMatchObject({
      code: "TOK_002",
    });
    expect(await manager.has("u1")).toBe(false);
    expect(await store.get("u1")).toBeUndefined();
  });

  it("keeps the grant on a transient failure", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockRejectedValueOnce(ERR.OIDC_003());

    await expect(manager.getAccessToken("u1")).rejects.toMatchObject({
      code: "OIDC_003",
    });
    expect(await manager.has("u1")).toBe(true);

    refresh.mockResolvedValueOnce(tokenSet());
    await expect(manager.getAccessToken("u1")).resolves.toBeDefined();
  });
});

describe("GrantManager.invalidate", () => {
  it("forces the next call to mint a fresh token for that resource only", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockResolvedValue(tokenSet());
    await manager.getAccessToken("u1", { resource: "a" });
    await manager.getAccessToken("u1", { resource: "b" });
    expect(refresh).toHaveBeenCalledTimes(2);

    manager.invalidate("u1", "a");
    await manager.getAccessToken("u1", { resource: "a" });
    await manager.getAccessToken("u1", { resource: "b" });

    expect(refresh).toHaveBeenCalledTimes(3);
  });
});

describe("GrantManager.save and revoke", () => {
  it("forgets cached tokens when a new sign-in replaces the grant", async () => {
    const { refresh, manager } = setup();
    await manager.save("u1", "refresh-0");
    refresh.mockResolvedValue(tokenSet());
    await manager.getAccessToken("u1");

    await manager.save("u1", "refresh-new");
    await manager.getAccessToken("u1");

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith("refresh-new", {});
  });

  it("revokes at the provider and forgets the grant", async () => {
    const { revoke, manager } = setup();
    await manager.save("u1", "refresh-0");

    await manager.revoke("u1");

    expect(revoke).toHaveBeenCalledWith("refresh-0", "refresh_token");
    expect(await manager.has("u1")).toBe(false);
  });

  it("forgets the grant even when the provider is unreachable", async () => {
    const { revoke, manager } = setup();
    await manager.save("u1", "refresh-0");
    revoke.mockRejectedValue(ERR.OIDC_003());

    await expect(manager.revoke("u1")).rejects.toMatchObject({
      code: "OIDC_003",
    });
    expect(await manager.has("u1")).toBe(false);
  });

  it("does nothing at the provider for an unknown grant", async () => {
    const { revoke, manager } = setup();
    await manager.revoke("ghost");
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("InProcessGrantLock", () => {
  it("runs tasks of one grant in order and tasks of others in parallel", async () => {
    const lock = new InProcessGrantLock();
    const order: string[] = [];
    const gate = Promise.withResolvers<void>();

    const first = lock.run("a", async () => {
      order.push("a1:start");
      await gate.promise;
      order.push("a1:end");
    });
    const second = lock.run("a", async () => {
      order.push("a2");
    });
    const other = lock.run("b", async () => {
      order.push("b");
    });

    await other;
    expect(order).toEqual(["a1:start", "b"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["a1:start", "b", "a1:end", "a2"]);
  });

  it("is not blocked by a failing task", async () => {
    const lock = new InProcessGrantLock();
    const failing = lock.run("a", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(lock.run("a", async () => "ok")).resolves.toBe("ok");
  });
});

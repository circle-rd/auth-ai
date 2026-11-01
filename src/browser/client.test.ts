import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthAiError } from "../errors.js";
import { createBrowserAuth } from "./client.js";
import type { BrowserAuth } from "./client.js";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let calls: Call[];
let handler: (call: Call) => Response;
let assign: ReturnType<typeof vi.fn<(url: string) => void>>;
let auth: BrowserAuth;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  calls = [];
  handler = () => json({});
  assign = vi.fn();
  auth = createBrowserAuth({
    fetch: async (input, init) => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      return handler(call);
    },
    location: { assign, pathname: "/projects", search: "?tab=2" },
  });
});

const user = {
  sub: "u1",
  roles: ["editor"],
  permissions: [],
  features: { maxProjects: 10 },
};

describe("getUser", () => {
  it("reads /me with the session cookie only", async () => {
    handler = () => json({ user, expiresAt: 1 });
    expect(await auth.getUser()).toEqual(user);
    expect(calls[0]?.url).toBe("/auth/me");
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("returns null when signed out", async () => {
    handler = () =>
      json({ error: { code: "SES_001", message: "Not signed in" } }, 401);
    expect(await auth.getUser()).toBeNull();
  });

  it("throws a typed error for any other failure", async () => {
    handler = () => json({ error: { code: "OIDC_003", message: "down" } }, 502);
    const err = await auth.getUser().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthAiError);
    expect(err).toMatchObject({ code: "OIDC_003", details: { status: 502 } });
  });

  it("flags a body that is not the documented shape", async () => {
    handler = () => json({ user: { sub: 1 }, expiresAt: 1 });
    await expect(auth.getUser()).rejects.toMatchObject({ code: "API_002" });
  });

  it("honours a custom base path", async () => {
    const custom = createBrowserAuth({
      basePath: "/api/sso",
      fetch: async (input) => {
        calls.push({ url: String(input), init: {} });
        return json({ user, expiresAt: 1 });
      },
    });
    await custom.getUser();
    expect(calls[0]?.url).toBe("/api/sso/me");
  });
});

describe("login and logout", () => {
  it("builds the login URL with an encoded target", () => {
    expect(auth.loginUrl()).toBe("/auth/login");
    expect(auth.loginUrl("/a?b=1&c=2")).toBe(
      "/auth/login?next=%2Fa%3Fb%3D1%26c%3D2",
    );
  });

  it("returns to the current page by default", () => {
    auth.login();
    expect(assign).toHaveBeenCalledWith(
      "/auth/login?next=%2Fprojects%3Ftab%3D2",
    );
    auth.login("/home");
    expect(assign).toHaveBeenLastCalledWith("/auth/login?next=%2Fhome");
  });

  it("ends the session then follows the provider logout URL", async () => {
    handler = () => json({ logoutUrl: "https://idp.test/end-session?x=1" });
    await auth.logout();
    expect(calls[0]?.url).toBe("/auth/logout");
    expect(calls[0]?.init.method).toBe("POST");
    expect(assign).toHaveBeenCalledWith("https://idp.test/end-session?x=1");
  });

  it("goes home when the provider offers no logout URL", async () => {
    handler = () => json({ logoutUrl: null });
    await auth.logout();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("does not navigate when the sign-out failed", async () => {
    handler = () => json({ error: { code: "SES_004", message: "no" } }, 403);
    await expect(auth.logout()).rejects.toMatchObject({ code: "SES_004" });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("data routes", () => {
  it("reads the wallet with bigint amounts", async () => {
    handler = () =>
      json({
        balance: "9007199254740993",
        isUnlimited: false,
        canSpend: true,
        currency: "eur",
        topupUrl: "https://idp.test/profile",
      });
    const wallet = await auth.getWallet();
    expect(wallet.balance).toBe(9007199254740993n);
    expect(wallet.topupUrl).toBe("https://idp.test/profile");
    expect(calls[0]?.url).toBe("/auth/wallet");
  });

  it("reads the statistics for a window", async () => {
    handler = () =>
      json({
        days: 7,
        total: "5",
        notBilled: "0",
        calls: 1,
        series: [],
        byApplication: [],
        byKind: [],
        byModel: [],
        daily: [],
      });
    expect((await auth.getWalletStats(7)).total).toBe(5n);
    expect(calls[0]?.url).toBe("/auth/wallet/stats?days=7");
    await auth.getWalletStats();
    expect(calls[1]?.url).toBe("/auth/wallet/stats");
  });

  it("lists the models", async () => {
    handler = () => json({ models: [{ id: "gpt-4o-mini" }] });
    expect((await auth.listModels())[0]?.id).toBe("gpt-4o-mini");
  });

  it("maps a gateway credit error to its SDK code", async () => {
    handler = () =>
      json({ error: { code: "GW_001", message: "Insufficient credit" } }, 402);
    await expect(auth.listModels()).rejects.toMatchObject({ code: "GW_001" });
  });

  it("keeps an unknown server code as an API error", async () => {
    handler = () =>
      json({ error: { code: "APP_009", message: "teapot" } }, 418);
    await expect(auth.getWallet()).rejects.toMatchObject({
      code: "API_001",
      details: { status: 418, apiCode: "APP_009" },
    });
  });

  it("copes with a non-JSON failure", async () => {
    handler = () => new Response("<html>bad gateway</html>", { status: 502 });
    await expect(auth.getWallet()).rejects.toMatchObject({
      code: "API_001",
      details: { status: 502 },
    });
  });
});

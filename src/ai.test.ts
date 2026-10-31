import { beforeEach, describe, expect, it } from "vitest";
import { createAiClient } from "./ai.js";
import type { AiClient } from "./ai.js";
import { GrantManager, MemoryGrantStore } from "./grants.js";
import {
  GATEWAY_URL,
  ISSUER,
  createCombinedFetch,
  createMockGateway,
  createMockIdp,
  createTestAuth,
  jsonResponse,
} from "./test-support/mock-idp.js";
import type { MockGateway, MockIdp } from "./test-support/mock-idp.js";
import { createAuthClient } from "./client.js";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
} from "./test-support/mock-idp.js";

let idp: MockIdp;
let gateway: MockGateway;
let grants: GrantManager;
let ai: AiClient;
let resources: string[];

function build(gatewayUrl: string | undefined) {
  const auth = createAuthClient(
    {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      ...(gatewayUrl ? { gatewayUrl } : {}),
    },
    { fetch: createCombinedFetch(idp, gateway) },
  );
  grants = new GrantManager({ auth, store: new MemoryGrantStore() });
  ai = createAiClient({ auth, grants });
}

beforeEach(async () => {
  idp = await createMockIdp();
  gateway = createMockGateway();
  resources = [];
  idp.tokenHandler = (request) => {
    const resource = request.form.get("resource") ?? "none";
    resources.push(resource);
    return jsonResponse({
      access_token: `token-for-${resource}`,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: `refresh-${resources.length}`,
    });
  };
  build(GATEWAY_URL);
});

describe("forUser", () => {
  it("reads the wallet with a token narrowed to auth-service", async () => {
    await grants.save("u1", "refresh-0");
    idp.apiHandler = () =>
      jsonResponse({
        balance: "5000000",
        isUnlimited: false,
        canSpend: true,
        currency: "eur",
      });

    const account = await ai.forUser("u1").wallet.getAccount();

    expect(account.balance).toBe(5_000_000n);
    expect(resources).toEqual([ISSUER]);
    expect(idp.requests.at(-1)?.headers.get("authorization")).toBe(
      `Bearer token-for-${ISSUER}`,
    );
  });

  it("calls the gateway with a token narrowed to the gateway audience", async () => {
    await grants.save("u1", "refresh-0");
    gateway.handler = () => jsonResponse({ data: [{ id: "gpt-4o-mini" }] });

    const models = await ai.forUser("u1").gateway.listModels();

    expect(models[0]?.id).toBe("gpt-4o-mini");
    expect(resources).toEqual([GATEWAY_URL]);
    expect(gateway.requests[0]?.headers.get("authorization")).toBe(
      `Bearer token-for-${GATEWAY_URL}`,
    );
  });

  it("keeps one refresh chain across wallet and gateway calls", async () => {
    await grants.save("u1", "refresh-0");
    idp.apiHandler = () =>
      jsonResponse({
        balance: "1",
        isUnlimited: false,
        canSpend: true,
        currency: "eur",
      });
    gateway.handler = () => jsonResponse({ data: [] });
    const user = ai.forUser("u1");

    await Promise.all([user.wallet.getAccount(), user.gateway.listModels()]);

    const presented = idp
      .requestsTo("/token")
      .map((r) => r.form.get("refresh_token"));
    expect(presented).toEqual(["refresh-0", "refresh-1"]);
  });

  it("reuses a gateway token until it nears expiry, and mints a new one after a 401", async () => {
    await grants.save("u1", "refresh-0");
    let status = 200;
    gateway.handler = () =>
      status === 200
        ? jsonResponse({ data: [] })
        : new Response(null, { status });
    const { gateway: gw } = ai.forUser("u1");

    await gw.listModels();
    await gw.listModels();
    expect(resources).toHaveLength(1);

    status = 401;
    await gw.listModels().catch(() => undefined);
    status = 200;
    await gw.listModels();
    expect(resources).toHaveLength(2);
  });

  it("requires a sign-in when the user has no grant", async () => {
    await expect(ai.forUser("ghost").wallet.getAccount()).rejects.toMatchObject(
      {
        code: "TOK_002",
      },
    );
  });

  it("builds the gateway client once per user object", () => {
    const user = ai.forUser("u1");
    expect(user.gateway).toBe(user.gateway);
  });

  it("explains how to enable the gateway when no URL is configured", () => {
    build(undefined);
    expect(() => ai.forUser("u1").gateway).toThrowError(
      expect.objectContaining({ code: "CFG_001" }),
    );
  });
});

describe("test helper", () => {
  it("builds a client", () => {
    expect(createTestAuth(idp).config.issuer).toBe(ISSUER);
  });
});

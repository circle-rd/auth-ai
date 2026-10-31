import { beforeEach, describe, expect, it } from "vitest";
import { createAuthClient } from "../client.js";
import { AuthAiError } from "../errors.js";
import {
  CLIENT_ID,
  ISSUER,
  REDIRECT_URI,
  createMockIdp,
  createTestAuth,
  jsonResponse,
} from "../test-support/mock-idp.js";
import type { MockIdp, RecordedRequest } from "../test-support/mock-idp.js";
import { createMachineApi } from "./machine-api.js";
import type { MachineApi } from "./machine-api.js";

const APPLICATION_ID = "5d1c6b0e-8f0e-4a43-9a52-3b8c2f9d7a10";

let idp: MockIdp;
let api: MachineApi;
let issued: number;

beforeEach(async () => {
  idp = await createMockIdp();
  issued = 0;
  idp.tokenHandler = () => {
    issued += 1;
    return jsonResponse({
      access_token: `machine-${issued}`,
      token_type: "Bearer",
      expires_in: 3600,
    });
  };
  idp.apiHandler = () => jsonResponse({});
  api = createMachineApi(createTestAuth(idp), {
    applicationId: APPLICATION_ID,
  });
});

function lastApiRequest(): RecordedRequest {
  const request = idp.requests
    .filter((r) => r.url.pathname.startsWith("/api/"))
    .at(-1);
  if (!request) throw new Error("no API request was made");
  return request;
}

async function rejection(promise: Promise<unknown>): Promise<AuthAiError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthAiError);
  return err as AuthAiError;
}

describe("machine tokens", () => {
  it("mints one token per scope and caches it", async () => {
    idp.apiHandler = () => jsonResponse({ subscription: null });
    await api.billing.getSubscription("u1");
    await api.billing.getSubscription("u2");

    const grants = idp.requestsTo("/token");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.form.get("grant_type")).toBe("client_credentials");
    expect(grants[0]?.form.get("scope")).toBe("billing:read");
    expect(lastApiRequest().headers.get("authorization")).toBe(
      "Bearer machine-1",
    );
  });

  it("shares one token request between concurrent calls", async () => {
    idp.apiHandler = () => jsonResponse({ subscription: null });
    await Promise.all([
      api.billing.getSubscription("u1"),
      api.billing.getSubscription("u2"),
      api.billing.getSubscription("u3"),
    ]);
    expect(idp.requestsTo("/token")).toHaveLength(1);
  });

  it("retries once with a fresh token after a 401", async () => {
    let calls = 0;
    idp.apiHandler = (request) => {
      calls += 1;
      return request.headers.get("authorization") === "Bearer machine-2"
        ? jsonResponse({ subscription: null })
        : jsonResponse(
            { error: { code: "AUTH_001", message: "expired" } },
            401,
          );
    };
    await expect(api.billing.getSubscription("u1")).resolves.toBeNull();
    expect(calls).toBe(2);
    expect(issued).toBe(2);
  });

  it("gives up after a second 401", async () => {
    idp.apiHandler = () =>
      jsonResponse({ error: { code: "AUTH_001", message: "nope" } }, 401);
    const err = await rejection(api.billing.getSubscription("u1"));
    expect(err.code).toBe("API_001");
    expect(err.details).toEqual({ status: 401, apiCode: "AUTH_001" });
  });

  it("requires a confidential client", () => {
    const publicAuth = createAuthClient(
      { issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT_URI },
      { fetch: idp.fetch },
    );
    expect(() => createMachineApi(publicAuth)).toThrowError(
      expect.objectContaining({ code: "CFG_001" }),
    );
  });
});

describe("billing", () => {
  it("reads the subscription", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        subscription: {
          plan: { id: "p1", name: "Premium" },
          isActive: true,
          expiresAt: null,
          stripeStatus: "active",
          currentPeriodStart: "2026-10-01T00:00:00.000Z",
          currentPeriodEnd: "2026-11-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          canceledAt: null,
        },
      });
    const subscription = await api.billing.getSubscription("user/1");
    expect(subscription?.plan.name).toBe("Premium");
    expect(lastApiRequest().url.pathname).toBe(
      "/api/app/billing/users/user%2F1/subscription",
    );
  });

  it("reads the usage", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        periodStart: "2026-10-01T00:00:00.000Z",
        features: [
          {
            featureKey: "tokens",
            unit: null,
            usageLimit: -1,
            used: 5,
            remaining: null,
          },
        ],
      });
    const usage = await api.billing.getUsage("u1");
    expect(usage.features[0]?.used).toBe(5);
    expect(lastApiRequest().url.pathname).toBe(
      "/api/app/billing/users/u1/usage",
    );
  });

  it("pages through invoices", async () => {
    idp.apiHandler = () => jsonResponse({ items: [], nextCursor: null });
    const page = await api.billing.listInvoices("u1", {
      limit: 10,
      cursor: "c1",
    });
    expect(page).toEqual({ items: [], nextCursor: null });
    const { searchParams, pathname } = lastApiRequest().url;
    expect(pathname).toBe("/api/app/billing/users/u1/invoices");
    expect(searchParams.get("limit")).toBe("10");
    expect(searchParams.get("cursor")).toBe("c1");

    await api.billing.listInvoices("u1");
    expect(lastApiRequest().url.search).toBe("");
  });

  it("flags a response that is not what auth-service documents", async () => {
    idp.apiHandler = () => jsonResponse({ subscription: { plan: "gold" } });
    expect((await rejection(api.billing.getSubscription("u1"))).code).toBe(
      "API_002",
    );
  });
});

describe("consumption", () => {
  it("reports usage for the application", async () => {
    idp.apiHandler = () =>
      jsonResponse({ success: true, aggregate: { key: "docs", total: "12" } });
    const result = await api.consumption.report({
      userId: "u1",
      key: "docs",
      value: 2,
      idempotencyKey: "req-1",
    });
    expect(result).toEqual({
      aggregate: { key: "docs", total: "12" },
      metered: false,
    });
    const request = lastApiRequest();
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body ?? "")).toEqual({
      applicationId: APPLICATION_ID,
      userId: "u1",
      key: "docs",
      value: 2,
      idempotencyKey: "req-1",
    });
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(idp.requestsTo("/token")[0]?.form.has("scope")).toBe(false);
  });

  it("reports a metered key as such", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        success: true,
        metered: true,
        aggregate: { key: "ai", total: "3" },
      });
    expect(
      (await api.consumption.report({ userId: "u1", key: "ai", value: 1 }))
        .metered,
    ).toBe(true);
  });

  it.each([
    ["a key with a dash", { key: "a-b" }],
    ["a key over 64 characters", { key: "a".repeat(65) }],
    ["a non-finite value", { value: Number.POSITIVE_INFINITY }],
    ["an empty user", { userId: "" }],
  ])("rejects %s before any request", async (_label, override) => {
    const err = await rejection(
      api.consumption.report({
        userId: "u1",
        key: "docs",
        value: 1,
        ...override,
      }),
    );
    expect(err.code).toBe("CFG_001");
    expect(idp.requests).toHaveLength(0);
  });

  it("lists and reads running totals", async () => {
    idp.apiHandler = (request) =>
      request.url.pathname.endsWith("/docs")
        ? jsonResponse({
            aggregate: {
              key: "docs",
              total: "12",
              updatedAt: "2026-10-31T08:00:00.000Z",
            },
          })
        : jsonResponse({
            aggregates: [
              {
                key: "docs",
                total: "12",
                updatedAt: "2026-10-31T08:00:00.000Z",
              },
            ],
          });
    expect(await api.consumption.list("u1")).toHaveLength(1);
    expect(lastApiRequest().url.pathname).toBe(
      `/api/consumption/u1/${APPLICATION_ID}`,
    );
    expect((await api.consumption.get("u1", "docs")).total).toBe("12");
    expect(lastApiRequest().url.pathname).toBe(
      `/api/consumption/u1/${APPLICATION_ID}/docs`,
    );
  });

  it("surfaces an unknown key as an API error", async () => {
    idp.apiHandler = () =>
      jsonResponse(
        {
          error: { code: "CONS_003", message: "Consumption record not found" },
        },
        404,
      );
    const err = await rejection(api.consumption.get("u1", "ghost"));
    expect(err.details).toEqual({ status: 404, apiCode: "CONS_003" });
  });

  it("needs the application id, and a UUID", () => {
    const auth = createTestAuth(idp);
    expect(() => createMachineApi(auth).consumption).toThrowError(
      expect.objectContaining({ code: "CFG_001" }),
    );
    expect(
      () => createMachineApi(auth, { applicationId: "my-app" }).consumption,
    ).toThrowError(expect.objectContaining({ code: "CFG_001" }));
  });

  it("builds the consumption client once", () => {
    expect(api.consumption).toBe(api.consumption);
  });
});

describe("wallet", () => {
  it("reads an account with a bigint balance", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        balance: "9007199254740993",
        isUnlimited: false,
        canSpend: true,
        currency: "eur",
      });
    const account = await api.wallet.getAccount("u1");
    expect(account.balance).toBe(9007199254740993n);
    expect(idp.requestsTo("/token")[0]?.form.get("scope")).toBe("wallet:read");
  });

  it("debits an exact amount", async () => {
    idp.apiHandler = () =>
      jsonResponse(
        {
          transaction: {
            id: "t1",
            type: "usage",
            amount: "1500000",
            delta: "-1500000",
            balanceAfter: "-500000",
            applicationId: null,
            metadata: { source: "export" },
            createdAt: "2026-10-31T08:00:00.000Z",
          },
          replayed: false,
        },
        201,
      );
    const result = await api.wallet.recordUsage("u1", {
      amount: 1_500_000n,
      idempotencyKey: "job-1",
      applicationSlug: "my-app",
      metadata: { source: "export" },
    });
    expect(result.replayed).toBe(false);
    expect(result.transaction.balanceAfter).toBe(-500000n);
    const request = lastApiRequest();
    expect(JSON.parse(request.body ?? "")).toEqual({
      amount: "1500000",
      idempotencyKey: "job-1",
      applicationSlug: "my-app",
      metadata: { source: "export" },
    });
    expect(idp.requestsTo("/token")[0]?.form.get("scope")).toBe("wallet:debit");
  });

  it("sends a dollar cost untouched", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        transaction: {
          id: "t1",
          type: "usage",
          amount: "10",
          delta: "-10",
          balanceAfter: "0",
          applicationId: null,
          metadata: {},
          createdAt: "2026-10-31T08:00:00.000Z",
        },
        replayed: true,
      });
    await api.wallet.recordUsage("u1", {
      costUsd: "0.0123",
      idempotencyKey: "k",
    });
    expect(JSON.parse(lastApiRequest().body ?? "")).toEqual({
      costUsd: "0.0123",
      idempotencyKey: "k",
    });
  });

  it.each([
    ["neither amount nor cost", { idempotencyKey: "k" }],
    ["both amount and cost", { amount: 1n, costUsd: "1", idempotencyKey: "k" }],
    ["a zero amount", { amount: 0n, idempotencyKey: "k" }],
    ["a zero cost", { costUsd: "0.0", idempotencyKey: "k" }],
    ["a float-looking cost", { costUsd: "1e-3", idempotencyKey: "k" }],
  ])("rejects %s before any request", async (_label, input) => {
    const err = await rejection(api.wallet.recordUsage("u1", input));
    expect(err.code).toBe("CFG_001");
    expect(idp.requests).toHaveLength(0);
  });

  it("maps an API error without a standard envelope", async () => {
    idp.apiHandler = () => new Response("bad gateway", { status: 502 });
    const err = await rejection(api.wallet.getAccount("u1"));
    expect(err.details).toEqual({ status: 502 });
  });
});

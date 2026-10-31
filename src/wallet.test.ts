import { beforeEach, describe, expect, it } from "vitest";
import { AuthAiError } from "./errors.js";
import { JsonHttp } from "./http.js";
import { MICRO_PER_EUR, WalletClient, formatEuros } from "./wallet.js";
import {
  ISSUER,
  createMockIdp,
  jsonResponse,
} from "./test-support/mock-idp.js";
import type { MockIdp } from "./test-support/mock-idp.js";

let idp: MockIdp;
let wallet: WalletClient;
let invalidated: string[];
let minted: number;

beforeEach(async () => {
  idp = await createMockIdp();
  invalidated = [];
  minted = 0;
  wallet = new WalletClient(
    new JsonHttp({
      baseUrl: ISSUER,
      fetch: idp.fetch,
      timeoutMs: 5_000,
      tokens: {
        getToken: async () => `user-token-${(minted += 1)}`,
        invalidate: (key) => invalidated.push(key),
      },
    }),
    ISSUER,
  );
});

const lastRequest = () => idp.requests.at(-1);

const model = {
  model: "gpt-4o-mini",
  amount: "18420",
  count: 6,
  promptTokens: 1200,
  completionTokens: 400,
  totalTokens: 1600,
};
const application = {
  applicationId: "a1",
  name: "My app",
  slug: "my-app",
  amount: "18420",
  count: 6,
};

describe("account", () => {
  it("reads the balance as a bigint with the user token", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        balance: "-9007199254740993",
        isUnlimited: false,
        canSpend: false,
        currency: "eur",
      });
    const account = await wallet.getAccount();
    expect(account).toEqual({
      balance: -9007199254740993n,
      isUnlimited: false,
      canSpend: false,
      currency: "eur",
    });
    expect(lastRequest()?.url.pathname).toBe("/api/user/wallet");
    expect(lastRequest()?.headers.get("authorization")).toBe(
      "Bearer user-token-1",
    );
  });

  it("retries once with a fresh token after a 401", async () => {
    idp.apiHandler = (request) =>
      request.headers.get("authorization") === "Bearer user-token-2"
        ? jsonResponse({
            balance: "1",
            isUnlimited: false,
            canSpend: true,
            currency: "eur",
          })
        : jsonResponse(
            { error: { code: "AUTH_001", message: "expired" } },
            401,
          );
    expect((await wallet.getAccount()).canSpend).toBe(true);
    expect(invalidated).toEqual(["wallet"]);
  });

  it("rejects a balance that is not an integer string", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        balance: 5,
        isUnlimited: false,
        canSpend: true,
        currency: "eur",
      });
    await expect(wallet.getAccount()).rejects.toMatchObject({
      code: "API_002",
    });
  });

  it("surfaces the auth-service error code", async () => {
    idp.apiHandler = () =>
      jsonResponse({ error: { code: "AUTH_011", message: "scope" } }, 403);
    const err = await wallet.getAccount().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthAiError);
    expect((err as AuthAiError).details).toEqual({
      status: 403,
      apiCode: "AUTH_011",
    });
  });
});

describe("stats and session usage", () => {
  it("parses the spend statistics", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        days: 7,
        total: "18420",
        notBilled: "0",
        calls: 6,
        series: [{ date: "2026-10-30", amount: "18420", count: 6 }],
        byApplication: [application],
        byKind: [{ kind: "llm", amount: "18420", count: 6 }],
        byModel: [model],
        daily: [
          {
            date: "2026-10-30",
            amount: "18420",
            count: 6,
            byApplication: [application],
            byModel: [model],
          },
        ],
      });
    const stats = await wallet.getStats({ days: 7 });
    expect(stats.total).toBe(18420n);
    expect(stats.byModel[0]?.totalTokens).toBe(1600);
    expect(stats.daily[0]?.byApplication[0]?.slug).toBe("my-app");
    expect(lastRequest()?.url.searchParams.get("days")).toBe("7");

    await wallet.getStats();
    expect(lastRequest()?.url.search).toBe("");
  });

  it("reads what a session spent", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        sessionId: "s 1",
        applicationSlug: "my-app",
        days: 30,
        total: "18420",
        notBilled: "0",
        calls: 6,
        byModel: [model],
      });
    const usage = await wallet.getSessionUsage("s 1", { days: 30 });
    expect(usage.total).toBe(18420n);
    expect(lastRequest()?.url.searchParams.get("sessionId")).toBe("s 1");
    expect(lastRequest()?.url.searchParams.get("days")).toBe("30");
  });
});

describe("transactions and top-up", () => {
  it("pages through the ledger", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        items: [
          {
            id: "t1",
            type: "topup",
            amount: "5000000",
            delta: "5000000",
            balanceAfter: "5000000",
            applicationId: null,
            metadata: { invoice: "INV-1" },
            createdAt: "2026-10-31T08:00:00.000Z",
          },
        ],
        nextCursor: "c2",
      });
    const page = await wallet.listTransactions({
      limit: 1,
      cursor: "c1",
      type: "topup",
    });
    expect(page.nextCursor).toBe("c2");
    expect(page.items[0]?.delta).toBe(5_000_000n);
    const { searchParams } = lastRequest()!.url;
    expect(searchParams.get("limit")).toBe("1");
    expect(searchParams.get("cursor")).toBe("c1");
    expect(searchParams.get("type")).toBe("topup");
  });

  it("tells whether online top-up is enabled", async () => {
    idp.apiHandler = () =>
      jsonResponse({
        enabled: false,
        currency: "eur",
        minCents: 500,
        maxCents: 50000,
      });
    expect((await wallet.getTopupOptions()).enabled).toBe(false);
  });

  it("links to the profile page, where checkout needs the user's session", () => {
    expect(wallet.topupUrl()).toBe(`${ISSUER}/profile`);
  });
});

describe("formatEuros", () => {
  it.each([
    [0n, 2, "0.00"],
    [5_000_000n, 2, "5.00"],
    [1_234_567n, 2, "1.23"],
    [1_234_567n, 6, "1.234567"],
    [1_999_999n, 0, "1"],
    [999_999n, 2, "0.99"],
    [-500_000n, 2, "-0.50"],
    [-1n, 2, "0.00"],
    [MICRO_PER_EUR * 1_000_000n, 2, "1000000.00"],
  ])("formats %s micro-euros at %s digits as %s", (amount, digits, text) => {
    expect(formatEuros(amount, digits)).toBe(text);
  });

  it("refuses a digit count outside 0 to 6", () => {
    expect(() => formatEuros(1n, 7)).toThrow(RangeError);
    expect(() => formatEuros(1n, 1.5)).toThrow(RangeError);
  });
});

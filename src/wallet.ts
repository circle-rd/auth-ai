import { z } from "zod";
import type { JsonHttp } from "./http.js";

/** 1 EUR in the ledger unit. */
export const MICRO_PER_EUR = 1_000_000n;

// Amounts travel as integer strings of micro-euros: a JSON number cannot carry them exactly.
const amountSchema = z
  .string()
  .regex(/^-?[0-9]{1,19}$/, "must be an integer string of micro-euros")
  .transform((value) => BigInt(value));

const isoDateSchema = z.iso.datetime();

export const walletTransactionTypeSchema = z.enum([
  "topup",
  "grant",
  "refund",
  "usage",
  "adjust",
  "reversal",
]);

export const walletAccountSchema = z.object({
  /** Negative when usage or a refund exceeded the credit. */
  balance: amountSchema,
  isUnlimited: z.boolean(),
  /** Whether new spending is allowed: unlimited, or a strictly positive balance. */
  canSpend: z.boolean(),
  currency: z.literal("eur"),
});

export const walletTransactionSchema = z.object({
  id: z.string(),
  type: walletTransactionTypeSchema,
  amount: amountSchema,
  delta: amountSchema,
  balanceAfter: amountSchema,
  applicationId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoDateSchema,
});

export const walletTransactionPageSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});

const modelEntrySchema = z.object({
  /** `mcp` for tool calls, `other` when the gateway reported no model. */
  model: z.string(),
  amount: amountSchema,
  count: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

const applicationEntrySchema = z.object({
  applicationId: z.string().nullable(),
  name: z.string().nullable(),
  slug: z.string().nullable(),
  amount: amountSchema,
  count: z.number(),
});

export const walletStatsSchema = z.object({
  days: z.number(),
  total: amountSchema,
  /** Part of `total` never deducted: usage on an unlimited account. */
  notBilled: amountSchema,
  calls: z.number(),
  series: z.array(
    z.object({ date: z.string(), amount: amountSchema, count: z.number() }),
  ),
  byApplication: z.array(applicationEntrySchema),
  byKind: z.array(
    z.object({ kind: z.string(), amount: amountSchema, count: z.number() }),
  ),
  byModel: z.array(modelEntrySchema),
  daily: z.array(
    z.object({
      date: z.string(),
      amount: amountSchema,
      count: z.number(),
      byApplication: z.array(applicationEntrySchema),
      byModel: z.array(modelEntrySchema),
    }),
  ),
});

export const walletSessionUsageSchema = z.object({
  sessionId: z.string(),
  applicationSlug: z.string().nullable(),
  days: z.number(),
  total: amountSchema,
  notBilled: amountSchema,
  calls: z.number(),
  byModel: z.array(modelEntrySchema),
});

export const topupOptionsSchema = z.object({
  enabled: z.boolean(),
  currency: z.literal("eur"),
  minCents: z.number(),
  maxCents: z.number(),
});

export type WalletAccount = z.infer<typeof walletAccountSchema>;
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;
export type WalletTransactionPage = z.infer<typeof walletTransactionPageSchema>;
export type WalletTransactionType = z.infer<typeof walletTransactionTypeSchema>;
export type WalletStats = z.infer<typeof walletStatsSchema>;
export type WalletSessionUsage = z.infer<typeof walletSessionUsageSchema>;
export type TopupOptions = z.infer<typeof topupOptionsSchema>;

export interface WalletStatsOptions {
  /** 1 to 90, 30 by default. */
  readonly days?: number;
}

export interface WalletSessionUsageOptions {
  /** 1 to 90, 30 by default. */
  readonly days?: number;
}

export interface ListTransactionsOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly type?: WalletTransactionType;
}

/**
 * Exact decimal euros of a micro-euro amount, e.g. `5000000n` gives `"5.00"`.
 * The amount is truncated toward zero at `fractionDigits` (0 to 6, 2 by
 * default): rounding up could show a user more credit than they hold.
 */
export function formatEuros(amount: bigint, fractionDigits = 2): string {
  if (
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 6
  ) {
    throw new RangeError("fractionDigits must be an integer from 0 to 6");
  }
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const whole = magnitude / MICRO_PER_EUR;
  const micro = (magnitude % MICRO_PER_EUR).toString().padStart(6, "0");
  const fraction = micro.slice(0, fractionDigits);
  const text = fractionDigits === 0 ? `${whole}` : `${whole}.${fraction}`;
  // A negative amount truncated to zero is not a debt worth a minus sign.
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/**
 * The signed-in user's own wallet, read with their access token for the
 * auth-service audience and the `wallet:self:read` scope. Debits are made by
 * the gateway after each call: an application only reads, and refills by
 * sending the user to `topupUrl()`.
 */
export class WalletClient {
  readonly #http: JsonHttp;
  readonly #issuer: string;

  constructor(http: JsonHttp, issuer: string) {
    this.#http = http;
    this.#issuer = issuer;
  }

  /** Decide with `canSpend` rather than recomputing it from the balance. */
  getAccount(): Promise<WalletAccount> {
    return this.#http.request({
      method: "GET",
      path: "/api/user/wallet",
      scope: WALLET_SCOPE_KEY,
      schema: walletAccountSchema,
    });
  }

  getStats(options: WalletStatsOptions = {}): Promise<WalletStats> {
    return this.#http.request({
      method: "GET",
      path: "/api/user/wallet/stats",
      scope: WALLET_SCOPE_KEY,
      query: { days: options.days },
      schema: walletStatsSchema,
    });
  }

  /**
   * What one chat session spent, for the calling application only. The id is
   * the one passed to the gateway as `metadata.session_id`.
   */
  getSessionUsage(
    sessionId: string,
    options: WalletSessionUsageOptions = {},
  ): Promise<WalletSessionUsage> {
    return this.#http.request({
      method: "GET",
      path: "/api/user/wallet/usage",
      scope: WALLET_SCOPE_KEY,
      query: { sessionId, days: options.days },
      schema: walletSessionUsageSchema,
    });
  }

  /** Newest first, keyset-paginated: pass `nextCursor` back until it is null. */
  listTransactions(
    options: ListTransactionsOptions = {},
  ): Promise<WalletTransactionPage> {
    return this.#http.request({
      method: "GET",
      path: "/api/user/wallet/transactions",
      scope: WALLET_SCOPE_KEY,
      query: {
        limit: options.limit,
        cursor: options.cursor,
        type: options.type,
      },
      schema: walletTransactionPageSchema,
    });
  }

  getTopupOptions(): Promise<TopupOptions> {
    return this.#http.request({
      method: "GET",
      path: "/api/user/wallet/topup-options",
      scope: WALLET_SCOPE_KEY,
      schema: topupOptionsSchema,
    });
  }

  /**
   * The Credit tab of the user's profile. Checkout needs the user's session,
   * not a bearer token, so an application links there instead of creating it.
   */
  topupUrl(): string {
    return `${this.#issuer}/profile`;
  }
}

/** Key handed to the token supplier: the wallet audience of auth-service. */
export const WALLET_SCOPE_KEY = "wallet";

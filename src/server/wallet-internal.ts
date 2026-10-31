import { z } from "zod";
import { ERR } from "../errors.js";
import {
  walletAccountSchema,
  walletMetadataSchema,
  walletTransactionSchema,
} from "../wallet-schemas.js";
import type { WalletAccount, WalletTransaction } from "../wallet-schemas.js";
import type { ApiHttp } from "./http.js";

const usageInputSchema = z
  .object({
    /** Exact charge, in micro-euros. */
    amount: z.bigint().positive().optional(),
    /** Provider cost in dollars as a plain decimal: the wallet prices it. */
    costUsd: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,18})?$/)
      .refine((value) => /[1-9]/.test(value), "must be greater than zero")
      .optional(),
    idempotencyKey: z.string().min(1).max(255),
    applicationSlug: z.string().min(1).max(64).optional(),
    metadata: walletMetadataSchema.optional(),
  })
  .refine(
    (input) => (input.amount === undefined) !== (input.costUsd === undefined),
    {
      message: "provide exactly one of amount or costUsd",
    },
  );

export type WalletUsageInput = z.input<typeof usageInputSchema>;

export interface WalletUsageResult {
  readonly transaction: WalletTransaction;
  /** True when the idempotency key was already applied: nothing was charged again. */
  readonly replayed: boolean;
}

const usageResponseSchema = z.object({
  transaction: walletTransactionSchema,
  replayed: z.boolean(),
});

/**
 * Wallet access of a trusted backend (scopes `wallet:read` and `wallet:debit`).
 * LLM calls through the gateway are billed by the gateway itself: use this for
 * usage that does not go through it. Users read their own wallet with their
 * token instead.
 */
export class WalletInternalApi {
  readonly #http: ApiHttp;

  constructor(http: ApiHttp) {
    this.#http = http;
  }

  getAccount(userId: string): Promise<WalletAccount> {
    return this.#http.request({
      method: "GET",
      path: `/api/internal/wallet/users/${encodeURIComponent(userId)}`,
      scope: "wallet:read",
      schema: walletAccountSchema,
    });
  }

  /** Debits the user; a balance may go negative, which blocks the next calls. */
  async recordUsage(
    userId: string,
    input: WalletUsageInput,
  ): Promise<WalletUsageResult> {
    const parsed = usageInputSchema.safeParse(input);
    if (!parsed.success) {
      throw ERR.CFG_001(
        `Invalid wallet usage: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { cause: parsed.error },
      );
    }
    const { amount, ...rest } = parsed.data;
    return this.#http.request({
      method: "POST",
      path: `/api/internal/wallet/users/${encodeURIComponent(userId)}/usage`,
      scope: "wallet:debit",
      body: {
        ...rest,
        ...(amount === undefined ? {} : { amount: amount.toString() }),
      },
      schema: usageResponseSchema,
    });
  }
}

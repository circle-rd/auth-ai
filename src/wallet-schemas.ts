import { z } from "zod";

const amountSchema = z
  .string()
  .regex(/^-?[0-9]{1,19}$/, "must be an integer string of micro-euros")
  .transform((value) => BigInt(value));

export const walletTransactionTypeSchema = z.enum([
  "topup",
  "grant",
  "refund",
  "usage",
  "adjust",
  "reversal",
]);

export const walletMetadataSchema = z.record(z.string(), z.unknown());

/** Amounts are integer micro-euros: they are bigint here, strings on the wire. */
export const walletAccountSchema = z.object({
  balance: amountSchema,
  isUnlimited: z.boolean(),
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
  metadata: walletMetadataSchema,
  createdAt: z.iso.datetime(),
});

export type WalletAccount = z.infer<typeof walletAccountSchema>;
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;
export type WalletTransactionType = z.infer<typeof walletTransactionTypeSchema>;

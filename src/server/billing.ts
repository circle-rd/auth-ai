import { z } from "zod";
import type { JsonHttp } from "../http.js";

const SCOPE = "billing:read";

export const subscriptionViewSchema = z.object({
  plan: z.object({ id: z.string(), name: z.string() }),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  stripeStatus: z.string().nullable(),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().nullable(),
});

export const usageViewSchema = z.object({
  periodStart: z.string(),
  features: z.array(
    z.object({
      featureKey: z.string(),
      unit: z.string().nullable(),
      /** The plan's hard cap for the period; -1 means unlimited. */
      usageLimit: z.number(),
      used: z.number(),
      /** Units left before the cap; null when unlimited. */
      remaining: z.number().nullable(),
    }),
  ),
});

export const invoiceViewSchema = z.object({
  id: z.string(),
  status: z.string(),
  billingReason: z.string().nullable(),
  currency: z.string(),
  amountDue: z.number(),
  amountPaid: z.number(),
  amountRemaining: z.number(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  createdAt: z.string(),
  hostedInvoiceUrl: z.string().nullable(),
  invoicePdf: z.string().nullable(),
});

export const invoicePageSchema = z.object({
  items: z.array(invoiceViewSchema),
  nextCursor: z.string().nullable(),
});

export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;
export type UsageView = z.infer<typeof usageViewSchema>;
export type InvoiceView = z.infer<typeof invoiceViewSchema>;
export type InvoicePage = z.infer<typeof invoicePageSchema>;

export interface ListInvoicesOptions {
  /** 1 to 100. */
  readonly limit?: number;
  readonly cursor?: string;
}

const subscriptionResponseSchema = z.object({
  subscription: subscriptionViewSchema.nullable(),
});

/**
 * What a user holds and has consumed in this application. The application is
 * the one behind the machine token: it cannot read another one.
 */
export class BillingApi {
  readonly #http: JsonHttp;

  constructor(http: JsonHttp) {
    this.#http = http;
  }

  /** `null` when the user holds no subscription. */
  async getSubscription(userId: string): Promise<SubscriptionView | null> {
    const { subscription } = await this.#http.request({
      method: "GET",
      path: `/api/app/billing/users/${encodeURIComponent(userId)}/subscription`,
      scope: SCOPE,
      schema: subscriptionResponseSchema,
    });
    return subscription;
  }

  getUsage(userId: string): Promise<UsageView> {
    return this.#http.request({
      method: "GET",
      path: `/api/app/billing/users/${encodeURIComponent(userId)}/usage`,
      scope: SCOPE,
      schema: usageViewSchema,
    });
  }

  /** Newest first, keyset-paginated: pass `nextCursor` back until it is null. */
  listInvoices(
    userId: string,
    options: ListInvoicesOptions = {},
  ): Promise<InvoicePage> {
    return this.#http.request({
      method: "GET",
      path: `/api/app/billing/users/${encodeURIComponent(userId)}/invoices`,
      scope: SCOPE,
      query: { limit: options.limit, cursor: options.cursor },
      schema: invoicePageSchema,
    });
  }
}

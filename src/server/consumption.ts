import { z } from "zod";
import { ERR } from "../errors.js";
import type { ApiHttp } from "./http.js";

const reportSchema = z.object({
  userId: z.string().min(1),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9.]+$/, "key must be alphanumeric with dots"),
  value: z.number().finite(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const aggregateSchema = z.object({ key: z.string(), total: z.string() });

const storedAggregateSchema = aggregateSchema.extend({
  updatedAt: z.string(),
});

const reportResponseSchema = z.object({
  success: z.literal(true),
  metered: z.boolean().optional(),
  aggregate: aggregateSchema,
});

export interface ConsumptionReport {
  readonly userId: string;
  /** Alphanumeric and dots, 64 characters at most. */
  readonly key: string;
  /** May be negative to credit back. */
  readonly value: number;
  /** The same key reported twice counts once: set it to make retries safe. */
  readonly idempotencyKey?: string;
}

export interface ConsumptionResult {
  /** `total` is a decimal string: the running total is not bounded by a double. */
  readonly aggregate: { readonly key: string; readonly total: string };
  /** True when the key prices a metered feature and was billed through Stripe. */
  readonly metered: boolean;
}

export type ConsumptionAggregate = z.infer<typeof storedAggregateSchema>;

/** Usage the application reports for its users, for features billed on consumption. */
export class ConsumptionApi {
  readonly #http: ApiHttp;
  readonly #applicationId: string;

  constructor(http: ApiHttp, applicationId: string) {
    if (!z.uuid().safeParse(applicationId).success) {
      throw ERR.CFG_001("applicationId must be the UUID of the application");
    }
    this.#http = http;
    this.#applicationId = applicationId;
  }

  async report(input: ConsumptionReport): Promise<ConsumptionResult> {
    const body = reportSchema.safeParse(input);
    if (!body.success) {
      throw ERR.CFG_001(
        `Invalid consumption report: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        { cause: body.error },
      );
    }
    const response = await this.#http.request({
      method: "POST",
      path: "/api/consumption",
      scope: "",
      body: { applicationId: this.#applicationId, ...body.data },
      schema: reportResponseSchema,
    });
    return {
      aggregate: response.aggregate,
      metered: response.metered ?? false,
    };
  }

  /** Every running total of a user. */
  async list(userId: string): Promise<ConsumptionAggregate[]> {
    const { aggregates } = await this.#http.request({
      method: "GET",
      path: this.#path(userId),
      scope: "",
      schema: z.object({ aggregates: z.array(storedAggregateSchema) }),
    });
    return aggregates;
  }

  /** One running total; rejects (API_001, CONS_003) when the key was never reported. */
  async get(userId: string, key: string): Promise<ConsumptionAggregate> {
    const { aggregate } = await this.#http.request({
      method: "GET",
      path: `${this.#path(userId)}/${encodeURIComponent(key)}`,
      scope: "",
      schema: z.object({ aggregate: storedAggregateSchema }),
    });
    return aggregate;
  }

  #path(userId: string): string {
    return `/api/consumption/${encodeURIComponent(userId)}/${this.#applicationId}`;
  }
}

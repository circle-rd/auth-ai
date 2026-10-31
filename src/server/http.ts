import { z } from "zod";
import type { AuthClient } from "../client.js";
import { ERR } from "../errors.js";
import type { MachineTokenProvider } from "./machine-tokens.js";

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export interface ApiRequest<T> {
  readonly method: "GET" | "POST";
  /** Path below the issuer; segments must already be URL-encoded. */
  readonly path: string;
  /** The machine scope the endpoint requires; empty when it requires none. */
  readonly scope: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  readonly schema: z.ZodType<T>;
}

/** Authenticated JSON calls to the auth-service REST API. */
export class ApiHttp {
  readonly #auth: Pick<AuthClient, "config" | "fetch">;
  readonly #tokens: Pick<MachineTokenProvider, "getToken" | "invalidate">;

  constructor(
    auth: Pick<AuthClient, "config" | "fetch">,
    tokens: Pick<MachineTokenProvider, "getToken" | "invalidate">,
  ) {
    this.#auth = auth;
    this.#tokens = tokens;
  }

  async request<T>(request: ApiRequest<T>): Promise<T> {
    let response = await this.#send(request);
    // A revoked or rotated credential surfaces as 401: retry once with a fresh token.
    if (response.status === 401) {
      this.#tokens.invalidate(request.scope);
      response = await this.#send(request);
    }
    if (!response.ok) throw await this.#toError(response);

    const parsed = request.schema.safeParse(await response.json());
    if (!parsed.success) {
      throw ERR.API_002(undefined, { cause: parsed.error });
    }
    return parsed.data;
  }

  async #send(request: ApiRequest<unknown>): Promise<Response> {
    const url = new URL(`${this.#auth.config.issuer}${request.path}`);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const token = await this.#tokens.getToken(request.scope);
    return this.#auth.fetch(url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(request.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(this.#auth.config.timeoutMs),
    });
  }

  async #toError(response: Response) {
    const body = apiErrorSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!body.success) {
      return ERR.API_001(`auth-service answered ${response.status}`, {
        details: { status: response.status },
      });
    }
    const { code, message } = body.data.error;
    return ERR.API_001(
      `auth-service answered ${response.status} ${code}: ${message}`,
      {
        details: { status: response.status, apiCode: code },
      },
    );
  }
}

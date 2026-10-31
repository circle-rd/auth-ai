import { z } from "zod";
import { AuthAiError, ERR, isAuthAiErrorCode } from "../errors.js";
import { gatewayModelSchema } from "../gateway.js";
import type { GatewayModel } from "../gateway.js";
import { sessionUserSchema } from "../session-user.js";
import type { SessionUser } from "../session-user.js";
import { walletAccountSchema, walletStatsSchema } from "../wallet.js";
import type { WalletStats } from "../wallet.js";

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const meSchema = z.object({ user: sessionUserSchema, expiresAt: z.number() });
const logoutSchema = z.object({ logoutUrl: z.string().nullable() });
const walletSchema = walletAccountSchema.extend({ topupUrl: z.string() });
const modelsSchema = z.object({ models: z.array(gatewayModelSchema) });

export type WalletView = z.infer<typeof walletSchema>;

export interface BrowserAuthOptions {
  /** Where the backend mounted the sign-in routes. */
  readonly basePath?: string;
  readonly fetch?: typeof fetch;
  /** Navigation target of `login` and `logout`; the page's `location` by default. */
  readonly location?: Pick<Location, "assign" | "pathname" | "search">;
}

export interface BrowserAuth {
  /** The signed-in user, or null when signed out. */
  getUser(): Promise<SessionUser | null>;
  loginUrl(next?: string): string;
  /** Sends the browser to the sign-in, then back to `next` (the current page by default). */
  login(next?: string): void;
  /** Ends the session and the provider's single sign-on session. */
  logout(): Promise<void>;
  /** Needs the backend routes enabled with the `ai` option. */
  getWallet(): Promise<WalletView>;
  getWalletStats(days?: number): Promise<WalletStats>;
  listModels(): Promise<GatewayModel[]>;
}

function toError(status: number, body: unknown): AuthAiError {
  const envelope = errorEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return ERR.API_001(`The server answered ${status}`, {
      details: { status },
    });
  }
  const { code, message } = envelope.data.error;
  return isAuthAiErrorCode(code)
    ? new AuthAiError(code, message, { details: { status } })
    : ERR.API_001(message, { details: { status, apiCode: code } });
}

/**
 * The browser side of the backend-for-frontend: it holds no token, only talks
 * to the application's own routes with the session cookie. Importing it pulls
 * no server code.
 */
export function createBrowserAuth(
  options: BrowserAuthOptions = {},
): BrowserAuth {
  const basePath = options.basePath ?? "/auth";
  const doFetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const where = (): NonNullable<BrowserAuthOptions["location"]> =>
    options.location ?? globalThis.location;

  async function send(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; ok: boolean; body: unknown }> {
    const response = await doFetch(`${basePath}${path}`, {
      credentials: "same-origin",
      redirect: "error",
      ...init,
      headers: { accept: "application/json", ...init.headers },
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.json().catch(() => undefined),
    };
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw ERR.API_002(undefined, { cause: parsed.error });
    return parsed.data;
  }

  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const result = await send(path, init);
    if (!result.ok) throw toError(result.status, result.body);
    return parse(schema, result.body);
  }

  const loginUrl = (next?: string): string =>
    next === undefined
      ? `${basePath}/login`
      : `${basePath}/login?next=${encodeURIComponent(next)}`;

  return {
    async getUser() {
      const result = await send("/me");
      if (result.status === 401) return null;
      if (!result.ok) throw toError(result.status, result.body);
      return parse(meSchema, result.body).user;
    },
    loginUrl,
    login(next) {
      const { pathname, search } = where();
      where().assign(loginUrl(next ?? `${pathname}${search}`));
    },
    async logout() {
      const { logoutUrl } = await call("/logout", logoutSchema, {
        method: "POST",
      });
      where().assign(logoutUrl ?? "/");
    },
    getWallet: () => call("/wallet", walletSchema),
    getWalletStats: (days) =>
      call(
        days === undefined ? "/wallet/stats" : `/wallet/stats?days=${days}`,
        walletStatsSchema,
      ),
    async listModels() {
      return (await call("/models", modelsSchema)).models;
    },
  };
}

import type { AuthClient } from "../client.js";
import { AuthAiError, ERR } from "../errors.js";

// A cached token is renewed this long before it expires.
const EXPIRY_SKEW_SECONDS = 30;

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

/**
 * `client_credentials` tokens of the application, one per scope set. They are
 * cached until shortly before they expire, and concurrent callers share one
 * request to the token endpoint.
 */
export class MachineTokenProvider {
  readonly #auth: Pick<AuthClient, "clientCredentials">;
  readonly #cache = new Map<string, CachedToken>();
  readonly #inflight = new Map<string, Promise<string>>();

  constructor(auth: Pick<AuthClient, "clientCredentials">) {
    this.#auth = auth;
  }

  getToken(scope: string): Promise<string> {
    const cached = this.#cache.get(scope);
    if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > Date.now() / 1000) {
      return Promise.resolve(cached.accessToken);
    }
    const pending = this.#inflight.get(scope);
    if (pending) return pending;

    const request = this.#auth
      .clientCredentials({ scope })
      .catch((err: unknown) => {
        // The provider only names the scope: say who can grant it.
        if (
          err instanceof AuthAiError &&
          err.details?.["oauthError"] === "invalid_scope"
        ) {
          throw ERR.TOK_004(
            `The application is not granted the machine scope "${scope}": a superadmin must add it to the application's machine scopes`,
            { details: { scope }, cause: err },
          );
        }
        throw err;
      })
      .then((tokens) => {
        this.#cache.set(scope, {
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
        });
        return tokens.accessToken;
      })
      .finally(() => this.#inflight.delete(scope));
    this.#inflight.set(scope, request);
    return request;
  }

  /** Drops a token the API refused, e.g. after a secret rotation. */
  invalidate(scope: string): void {
    this.#cache.delete(scope);
  }
}

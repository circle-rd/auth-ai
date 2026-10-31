import { ERR } from "./errors.js";
import { isInvalidGrant } from "./oauth-errors.js";
import type { AuthClient } from "./client.js";

/**
 * Persists the single refresh-token chain of a user. The provider rotates it
 * on every use, so a store must hold exactly one value per grant. Encrypt it
 * at rest: it is a long-lived credential.
 */
export interface GrantStore {
  get(grantId: string): Promise<string | undefined>;
  set(grantId: string, refreshToken: string): Promise<void>;
  delete(grantId: string): Promise<void>;
}

/**
 * Serialises the refreshes of one grant. The default lock only covers a single
 * process: replicas need a distributed lock (or a row lock in the store).
 */
export interface GrantLock {
  run<T>(grantId: string, task: () => Promise<T>): Promise<T>;
}

export interface AccessToken {
  readonly accessToken: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export interface GrantManagerOptions {
  readonly auth: Pick<AuthClient, "refresh" | "revoke">;
  readonly store: GrantStore;
  readonly lock?: GrantLock;
  /** A cached access token is renewed this long before it expires. */
  readonly expirySkewSeconds?: number;
}

const DEFAULT_EXPIRY_SKEW_SECONDS = 30;

export class MemoryGrantStore implements GrantStore {
  readonly #grants = new Map<string, string>();

  get(grantId: string): Promise<string | undefined> {
    return Promise.resolve(this.#grants.get(grantId));
  }

  set(grantId: string, refreshToken: string): Promise<void> {
    this.#grants.set(grantId, refreshToken);
    return Promise.resolve();
  }

  delete(grantId: string): Promise<void> {
    this.#grants.delete(grantId);
    return Promise.resolve();
  }
}

export class InProcessGrantLock implements GrantLock {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(grantId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(grantId) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);
    this.#tails.set(grantId, tail);
    try {
      return await current;
    } finally {
      if (this.#tails.get(grantId) === tail) this.#tails.delete(grantId);
    }
  }
}

/**
 * The only place that refreshes tokens. Access tokens are minted per resource
 * (RFC 8707) from the stored refresh token and cached in memory until shortly
 * before they expire; they are never persisted.
 */
export class GrantManager {
  readonly #auth: Pick<AuthClient, "refresh" | "revoke">;
  readonly #store: GrantStore;
  readonly #lock: GrantLock;
  readonly #skewSeconds: number;
  readonly #cache = new Map<string, AccessToken>();

  constructor(options: GrantManagerOptions) {
    this.#auth = options.auth;
    this.#store = options.store;
    this.#lock = options.lock ?? new InProcessGrantLock();
    this.#skewSeconds =
      options.expirySkewSeconds ?? DEFAULT_EXPIRY_SKEW_SECONDS;
  }

  /** Stores the refresh token obtained at sign-in, replacing any older chain. */
  async save(grantId: string, refreshToken: string): Promise<void> {
    await this.#lock.run(grantId, async () => {
      await this.#store.set(grantId, refreshToken);
      this.#forget(grantId);
    });
  }

  async has(grantId: string): Promise<boolean> {
    return (await this.#store.get(grantId)) !== undefined;
  }

  /**
   * Returns an access token for `resource` (or for the whole sign-in set when
   * omitted). Throws TOK_002 when the user has no grant or the provider
   * rejected it: the grant is then dropped and only a new sign-in restores it.
   */
  async getAccessToken(
    grantId: string,
    options: { readonly resource?: string } = {},
  ): Promise<AccessToken> {
    const key = cacheKey(grantId, options.resource);
    const cached = this.#cached(key);
    if (cached) return cached;

    return this.#lock.run(grantId, async () => {
      // Another caller may have refreshed while this one waited for the lock.
      const refreshed = this.#cached(key);
      if (refreshed) return refreshed;

      const refreshToken = await this.#store.get(grantId);
      if (refreshToken === undefined) throw ERR.TOK_002();

      let tokens;
      try {
        tokens = await this.#auth.refresh(
          refreshToken,
          options.resource ? { resource: options.resource } : {},
        );
      } catch (err) {
        if (isInvalidGrant(err)) {
          await this.#store.delete(grantId);
          this.#forget(grantId);
          throw ERR.TOK_002(undefined, { cause: err });
        }
        throw err;
      }

      // Providers may omit the refresh token when they do not rotate it.
      await this.#store.set(grantId, tokens.refreshToken ?? refreshToken);
      const token = {
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
      };
      this.#cache.set(key, token);
      return token;
    });
  }

  /** Drops a cached access token the API refused, so the next call mints a fresh one. */
  invalidate(grantId: string, resource?: string): void {
    this.#cache.delete(cacheKey(grantId, resource));
  }

  /** Revokes the refresh token at the provider, then forgets the grant. */
  async revoke(grantId: string): Promise<void> {
    await this.#lock.run(grantId, async () => {
      const refreshToken = await this.#store.get(grantId);
      try {
        if (refreshToken !== undefined) {
          await this.#auth.revoke(refreshToken, "refresh_token");
        }
      } finally {
        // An unreachable provider must not keep the user signed in locally.
        await this.#store.delete(grantId);
        this.#forget(grantId);
      }
    });
  }

  #cached(key: string): AccessToken | undefined {
    const token = this.#cache.get(key);
    if (!token) return undefined;
    if (token.expiresAt - this.#skewSeconds > Date.now() / 1000) return token;
    this.#cache.delete(key);
    return undefined;
  }

  #forget(grantId: string): void {
    const prefix = `${grantId}\0`;
    for (const key of this.#cache.keys()) {
      if (key.startsWith(prefix)) this.#cache.delete(key);
    }
  }
}

function cacheKey(grantId: string, resource: string | undefined): string {
  return `${grantId}\0${resource ?? ""}`;
}

export function createGrantManager(options: GrantManagerOptions): GrantManager {
  return new GrantManager(options);
}

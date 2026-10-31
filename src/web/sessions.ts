import type { IdTokenClaims } from "../claims.js";

/** A signed-in browser session, as kept by the application's backend. */
export interface Session {
  /** SHA-256 of the cookie value: a leaked store cannot be replayed as cookies. */
  readonly id: string;
  /** The provider's subject: also the key of the user's grant. */
  readonly userId: string;
  /** The provider session, which a back-channel logout names. */
  readonly sessionId: string | undefined;
  readonly claims: IdTokenClaims;
  /** Hint for the provider's logout endpoint. */
  readonly idToken: string;
  /** Unix seconds. */
  readonly createdAt: number;
  /** Absolute end of the session, in unix seconds. */
  readonly expiresAt: number;
  /** When the claims are next renewed from the provider, in unix seconds. */
  readonly renewAt: number;
}

/**
 * Where sessions live. Implement it on the database of the application; it
 * must survive restarts and be shared by every replica. Records are keyed by
 * `Session.id`, and `sessionId` and `userId` must be indexed.
 */
export interface SessionStore {
  create(session: Session): Promise<void>;
  /** Returns undefined for an unknown or expired session. */
  get(id: string): Promise<Session | undefined>;
  update(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  /** Removes every session of a provider session and returns what was removed. */
  deleteByProviderSession(sessionId: string): Promise<readonly Session[]>;
  countByUser(userId: string): Promise<number>;
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>();

  create(session: Session): Promise<void> {
    this.#sessions.set(session.id, session);
    return Promise.resolve();
  }

  get(id: string): Promise<Session | undefined> {
    const session = this.#sessions.get(id);
    if (session && session.expiresAt <= Date.now() / 1000) {
      this.#sessions.delete(id);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(session);
  }

  update(session: Session): Promise<void> {
    if (this.#sessions.has(session.id)) this.#sessions.set(session.id, session);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.#sessions.delete(id);
    return Promise.resolve();
  }

  deleteByProviderSession(sessionId: string): Promise<readonly Session[]> {
    const removed = [...this.#sessions.values()].filter(
      (session) => session.sessionId === sessionId,
    );
    for (const session of removed) this.#sessions.delete(session.id);
    return Promise.resolve(removed);
  }

  countByUser(userId: string): Promise<number> {
    const now = Date.now() / 1000;
    let count = 0;
    for (const session of this.#sessions.values()) {
      if (session.userId === userId && session.expiresAt > now) count += 1;
    }
    return Promise.resolve(count);
  }
}

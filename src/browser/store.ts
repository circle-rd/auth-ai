import { AuthAiError, ERR } from "../errors.js";
import type { SessionUser } from "../session-user.js";
import type { BrowserAuth } from "./client.js";

type Listener = () => void;

/** A value that notifies subscribers when it changes: what React and Vue both bind to. */
export interface Observable<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: Listener): () => void;
}

export function createObservable<T>(initial: T): Observable<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function asError(err: unknown): AuthAiError {
  return err instanceof AuthAiError
    ? err
    : ERR.API_001("The request failed", { cause: err });
}

export type AuthStatus =
  "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthState {
  readonly status: AuthStatus;
  readonly user: SessionUser | null;
  readonly error: AuthAiError | null;
}

export const INITIAL_AUTH_STATE: AuthState = {
  status: "loading",
  user: null,
  error: null,
};

export interface AuthStore {
  readonly state: Observable<AuthState>;
  /** Reads the session again: on mount, on focus, or after an API answered 401. */
  refresh(): Promise<void>;
}

export function createAuthStore(auth: Pick<BrowserAuth, "getUser">): AuthStore {
  const state = createObservable<AuthState>(INITIAL_AUTH_STATE);
  // A slow answer must not overwrite a newer one.
  let latest = 0;

  return {
    state,
    async refresh() {
      const ticket = (latest += 1);
      try {
        const user = await auth.getUser();
        if (ticket !== latest) return;
        state.set(
          user
            ? { status: "authenticated", user, error: null }
            : { status: "unauthenticated", user: null, error: null },
        );
      } catch (err) {
        if (ticket !== latest) return;
        // Keep the last known user: a failed refresh does not sign anyone out.
        state.set({
          status: "error",
          user: state.get().user,
          error: asError(err),
        });
      }
    },
  };
}

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface ResourceState<T> {
  readonly status: ResourceStatus;
  readonly data: T | null;
  readonly error: AuthAiError | null;
}

export interface ResourceStore<T> {
  readonly state: Observable<ResourceState<T>>;
  refresh(): Promise<void>;
  /** Loads now and, with `pollIntervalMs`, keeps reloading; returns the stop function. */
  start(): () => void;
}

export interface ResourceOptions {
  readonly pollIntervalMs?: number;
  /** Called when the load fails: e.g. refresh the session on SES_001. */
  readonly onError?: (error: AuthAiError) => void;
}

export function createResourceStore<T>(
  load: () => Promise<T>,
  options: ResourceOptions = {},
): ResourceStore<T> {
  const state = createObservable<ResourceState<T>>({
    status: "idle",
    data: null,
    error: null,
  });
  let latest = 0;

  async function refresh(): Promise<void> {
    const ticket = (latest += 1);
    const previous = state.get().data;
    state.set({ status: "loading", data: previous, error: null });
    try {
      const data = await load();
      if (ticket === latest) state.set({ status: "ready", data, error: null });
    } catch (err) {
      if (ticket !== latest) return;
      const error = asError(err);
      state.set({ status: "error", data: previous, error });
      options.onError?.(error);
    }
  }

  return {
    state,
    refresh,
    start() {
      void refresh();
      const timer = options.pollIntervalMs
        ? setInterval(() => void refresh(), options.pollIntervalMs)
        : undefined;
      return () => {
        // A load in flight when the consumer leaves must not write afterwards.
        latest += 1;
        if (timer !== undefined) clearInterval(timer);
      };
    },
  };
}

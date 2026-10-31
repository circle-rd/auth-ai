import {
  computed,
  getCurrentScope,
  inject,
  onScopeDispose,
  shallowRef,
} from "vue";
import type { App, ComputedRef, InjectionKey, ShallowRef } from "vue";
import { createBrowserAuth } from "../browser/client.js";
import type { BrowserAuth, WalletView } from "../browser/client.js";
import { createAuthStore, createResourceStore } from "../browser/store.js";
import type {
  AuthState,
  AuthStore,
  Observable,
  ResourceOptions,
  ResourceState,
} from "../browser/store.js";
import { getFeature, hasFeature, hasPermission, hasRole } from "../claims.js";
import type { FeatureValue, PermissionAction } from "../claims.js";
import type { GatewayModel } from "../gateway.js";
import type { SessionUser } from "../session-user.js";
import type { WalletStats } from "../wallet.js";

interface AuthContext {
  readonly auth: BrowserAuth;
  readonly store: AuthStore;
}

const AUTH_KEY: InjectionKey<AuthContext> = Symbol("auth-ai");

export interface AuthPluginOptions {
  /** Defaults to a client on `basePath`. */
  readonly auth?: BrowserAuth;
  readonly basePath?: string;
}

/** `app.use(createAuthPlugin())` reads the session once the app is mounted in a browser. */
export function createAuthPlugin(options: AuthPluginOptions = {}): {
  install(app: App): void;
} {
  return {
    install(app) {
      const auth =
        options.auth ??
        createBrowserAuth(
          options.basePath ? { basePath: options.basePath } : {},
        );
      const store = createAuthStore(auth);
      app.provide(AUTH_KEY, { auth, store });
      if (typeof window !== "undefined") void store.refresh();
    },
  };
}

function useContext(): AuthContext {
  const context = inject(AUTH_KEY, null);
  if (!context) throw new Error("Install createAuthPlugin() on the app");
  return context;
}

/** A ref that follows an observable until the calling scope is disposed. */
function follow<T>(source: Observable<T>): Readonly<ShallowRef<T>> {
  const state = shallowRef(source.get());
  const stop = source.subscribe(() => {
    state.value = source.get();
  });
  if (getCurrentScope()) onScopeDispose(stop);
  return state;
}

export interface UseAuthResult {
  readonly state: Readonly<ShallowRef<AuthState>>;
  readonly user: ComputedRef<SessionUser | null>;
  readonly login: (next?: string) => void;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const { auth, store } = useContext();
  const state = follow(store.state);
  return {
    state,
    user: computed(() => state.value.user),
    login: (next) => auth.login(next),
    logout: () => auth.logout(),
    refresh: () => store.refresh(),
  };
}

export interface Entitlements {
  hasRole(role: string): boolean;
  hasPermission(resource: string, action?: PermissionAction): boolean;
  hasFeature(key: string): boolean;
  getFeature(key: string): FeatureValue | undefined;
}

/** Entitlement checks reading the current user at call time, so templates stay reactive. */
export function useEntitlements(): Entitlements {
  const { user } = useAuth();
  return {
    hasRole: (role) => hasRole(user.value ?? {}, role),
    hasPermission: (resource, action) =>
      hasPermission(user.value ?? {}, resource, action),
    hasFeature: (key) => hasFeature(user.value ?? {}, key),
    getFeature: (key) => getFeature(user.value ?? {}, key),
  };
}

export interface UseResourceResult<T> {
  readonly state: Readonly<ShallowRef<ResourceState<T>>>;
  readonly refresh: () => Promise<void>;
}

function useResource<T>(
  load: (auth: BrowserAuth) => Promise<T>,
  options: ResourceOptions = {},
): UseResourceResult<T> {
  const { auth, store } = useContext();
  const resource = createResourceStore(() => load(auth), {
    ...options,
    onError: (error) => {
      if (error.code === "SES_001") void store.refresh();
    },
  });
  const state = follow(resource.state);
  if (getCurrentScope()) onScopeDispose(resource.start());
  else void resource.refresh();
  return { state, refresh: resource.refresh };
}

export interface UseWalletOptions {
  readonly pollIntervalMs?: number;
}

export function useWallet(
  options: UseWalletOptions = {},
): UseResourceResult<WalletView> {
  return useResource(
    (auth) => auth.getWallet(),
    options.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.pollIntervalMs },
  );
}

export function useWalletStats(days?: number): UseResourceResult<WalletStats> {
  return useResource((auth) => auth.getWalletStats(days));
}

export function useModels(): UseResourceResult<GatewayModel[]> {
  return useResource((auth) => auth.listModels());
}

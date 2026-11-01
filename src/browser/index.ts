export { createBrowserAuth } from "./client.js";
export type { BrowserAuth, BrowserAuthOptions, WalletView } from "./client.js";
export {
  INITIAL_AUTH_STATE,
  createAuthStore,
  createObservable,
  createResourceStore,
} from "./store.js";
export type {
  AuthState,
  AuthStatus,
  AuthStore,
  Observable,
  ResourceOptions,
  ResourceState,
  ResourceStatus,
  ResourceStore,
} from "./store.js";
export { getFeature, hasFeature, hasPermission, hasRole } from "../claims.js";
export { AuthAiError } from "../errors.js";
export { formatEuros } from "../wallet.js";
export type { SessionUser } from "../session-user.js";
export type { GatewayModel } from "../gateway.js";
export type { WalletStats } from "../wallet.js";

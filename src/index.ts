export { AuthClient, createAuthClient } from "./client.js";
export type { AuthClientOptions } from "./client.js";
export { DEFAULT_SCOPES } from "./config.js";
export type { AuthClientConfig, ResolvedAuthClientConfig } from "./config.js";
export {
  getFeature,
  hasFeature,
  hasPermission,
  hasRole,
  idTokenClaimsSchema,
} from "./claims.js";
export type {
  FeatureValue,
  IdTokenClaims,
  PermissionAction,
} from "./claims.js";
export { AuthAiError, ERR } from "./errors.js";
export type {
  AuthAiErrorCode,
  AuthAiErrorDetails,
  AuthAiErrorOptions,
} from "./errors.js";
export {
  GrantManager,
  InProcessGrantLock,
  MemoryGrantStore,
  createGrantManager,
} from "./grants.js";
export type {
  AccessToken,
  GrantLock,
  GrantManagerOptions,
  GrantStore,
} from "./grants.js";
export type { IntrospectionResult } from "./introspection.js";
export type {
  LoginHandshake,
  LoginRequest,
  LoginResult,
  LogoutUrlOptions,
  RefreshOptions,
  StartLoginOptions,
  TokenSet,
  TokenTypeHint,
} from "./types.js";

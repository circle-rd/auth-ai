import type { IdTokenClaims } from "./claims.js";

export interface TokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  readonly scope?: string;
  /** Absent when the provider issued none (no `offline_access`, or no rotation). */
  readonly refreshToken?: string;
  readonly idToken?: string;
}

/**
 * Secrets of one sign-in attempt. The caller persists them (typically in a
 * short-lived sealed cookie) between the redirect and the callback.
 */
export interface LoginHandshake {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface LoginRequest {
  readonly url: string;
  readonly handshake: LoginHandshake;
}

export interface StartLoginOptions {
  readonly prompt?: "login" | "consent" | "select_account" | "create" | "none";
  readonly loginHint?: string;
}

export interface LoginResult {
  readonly tokens: TokenSet & { readonly idToken: string };
  readonly claims: IdTokenClaims;
  /** The provider session, only present when end-session or back-channel logout is enabled for the application. */
  readonly sessionId: string | undefined;
}

export interface RefreshOptions {
  /** Narrows the new access token to one RFC 8707 audience. */
  readonly resource?: string;
}

export interface LogoutUrlOptions {
  readonly idTokenHint?: string;
  readonly state?: string;
}

export type TokenTypeHint = "access_token" | "refresh_token";

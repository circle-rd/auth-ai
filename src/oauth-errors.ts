import {
  AuthorizationResponseError,
  ClientError,
  ResponseBodyError,
} from "openid-client";
import { AuthAiError, ERR } from "./errors.js";
import type { AuthAiErrorDetails } from "./errors.js";

export type OAuthContext =
  "discovery" | "authorization-response" | "token-request";

/**
 * Maps an openid-client failure to the SDK registry. Response bodies are
 * reduced to the RFC 6749 `error` and `error_description` fields, which carry
 * no credential.
 */
export function toAuthAiError(
  err: unknown,
  context: OAuthContext,
): AuthAiError {
  if (err instanceof AuthAiError) return err;

  if (context === "discovery") {
    return ERR.OIDC_001(undefined, { cause: err });
  }

  if (err instanceof ResponseBodyError) {
    const details: Record<string, string | number> = {
      oauthError: err.error,
      status: err.status,
    };
    if (err.error_description) details["description"] = err.error_description;
    return ERR.OIDC_003(`Token endpoint rejected the request: ${err.error}`, {
      details,
      cause: err,
    });
  }

  if (err instanceof AuthorizationResponseError) {
    const details: AuthAiErrorDetails = { oauthError: err.error };
    return ERR.OIDC_002(`Authorization failed: ${err.error}`, {
      details,
      cause: err,
    });
  }

  if (context === "authorization-response" && err instanceof ClientError) {
    return ERR.OIDC_002(undefined, {
      details: err.code ? { reason: err.code } : {},
      cause: err,
    });
  }

  return context === "authorization-response"
    ? ERR.OIDC_002(undefined, { cause: err })
    : ERR.OIDC_003(undefined, { cause: err });
}

export function isInvalidGrant(err: unknown): boolean {
  return (
    err instanceof AuthAiError &&
    err.details?.["oauthError"] === "invalid_grant"
  );
}

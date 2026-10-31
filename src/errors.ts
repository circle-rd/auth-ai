export type AuthAiErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface AuthAiErrorOptions {
  readonly details?: AuthAiErrorDetails;
  readonly cause?: unknown;
}

const DEFAULT_MESSAGES = {
  CFG_001: "Invalid SDK configuration",
  OIDC_001: "Identity provider discovery failed",
  OIDC_002: "Invalid authorization response",
  OIDC_003: "Token request failed",
  OIDC_004: "The identity provider does not support this operation",
  TOK_001: "Token verification failed",
  TOK_002: "No usable grant for this user: sign in again",
  TOK_003: "Missing or malformed bearer credentials",
  TOK_004: "Insufficient scope",
  API_001: "auth-service rejected the request",
  API_002: "Unexpected response from auth-service",
  GW_001: "Insufficient credit: the wallet cannot pay for this call",
  GW_002: "The gateway rate limit was reached",
  GW_003: "The gateway refused the credentials or the resource",
  GW_004: "The gateway is temporarily unavailable",
  GW_005: "Unexpected response from the gateway",
} as const;

export type AuthAiErrorCode = keyof typeof DEFAULT_MESSAGES;

/**
 * Every failure raised by the SDK. `details` must never carry tokens, secrets
 * or other credentials: it is meant to be logged and serialised.
 */
export class AuthAiError extends Error {
  readonly code: AuthAiErrorCode;
  readonly details: AuthAiErrorDetails | undefined;

  constructor(
    code: AuthAiErrorCode,
    message: string,
    options: AuthAiErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AuthAiError";
    this.code = code;
    this.details = options.details;
  }

  toJSON(): {
    code: AuthAiErrorCode;
    message: string;
    details?: AuthAiErrorDetails;
  } {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

type ErrorFactory = (
  message?: string,
  options?: AuthAiErrorOptions,
) => AuthAiError;

function factory(code: AuthAiErrorCode): ErrorFactory {
  return (message = DEFAULT_MESSAGES[code], options) =>
    new AuthAiError(code, message, options);
}

// Domain prefixes mirror auth-service: CFG_ configuration, OIDC_ protocol
// exchanges with the identity provider, TOK_ token and grant handling, API_ calls to the auth-service REST API,
// GW_ calls to the LiteLLM gateway.
export const ERR = {
  CFG_001: factory("CFG_001"),
  OIDC_001: factory("OIDC_001"),
  OIDC_002: factory("OIDC_002"),
  OIDC_003: factory("OIDC_003"),
  OIDC_004: factory("OIDC_004"),
  TOK_001: factory("TOK_001"),
  TOK_002: factory("TOK_002"),
  TOK_003: factory("TOK_003"),
  TOK_004: factory("TOK_004"),
  API_001: factory("API_001"),
  API_002: factory("API_002"),
  GW_001: factory("GW_001"),
  GW_002: factory("GW_002"),
  GW_003: factory("GW_003"),
  GW_004: factory("GW_004"),
  GW_005: factory("GW_005"),
} as const satisfies Record<AuthAiErrorCode, ErrorFactory>;

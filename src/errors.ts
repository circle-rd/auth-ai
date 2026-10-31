export type AuthAiErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface AuthAiErrorOptions {
  readonly details?: AuthAiErrorDetails;
  readonly cause?: unknown;
}

const DEFAULT_MESSAGES = {
  CFG_001: "Invalid SDK configuration",
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

// Domain prefixes mirror auth-service: CFG_ is configuration.
export const ERR = {
  CFG_001: factory("CFG_001"),
} as const satisfies Record<AuthAiErrorCode, ErrorFactory>;

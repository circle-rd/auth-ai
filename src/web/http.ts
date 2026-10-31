import { AuthAiError, ERR } from "../errors.js";
import type { AuthAiErrorCode } from "../errors.js";

const STATUS_BY_CODE: Partial<Record<AuthAiErrorCode, number>> = {
  SES_001: 401,
  SES_002: 400,
  SES_004: 403,
  TOK_001: 401,
  TOK_002: 401,
  TOK_003: 401,
  TOK_004: 403,
  OIDC_002: 400,
  OIDC_001: 502,
  OIDC_003: 502,
  OIDC_004: 501,
  API_001: 502,
  API_002: 502,
  GW_001: 402,
  GW_002: 429,
  GW_003: 403,
  GW_004: 503,
  GW_005: 502,
};

export const NO_STORE = { "cache-control": "no-store" } as const;

// Wallet amounts are bigint micro-euros: they travel as integer strings.
const bigintToString = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Headers = new Headers(),
): Response {
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body, bigintToString), {
    status,
    headers,
  });
}

export function redirectResponse(
  location: string,
  status: 302 | 303,
  headers: Headers = new Headers(),
): Response {
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  return new Response(null, { status, headers });
}

/**
 * Serialises a failure as the same `{ error: { code, message } }` envelope
 * auth-service uses. The message of an SDK error carries no credential; any
 * other failure is reported to `onError` and answered generically.
 */
export function errorResponse(
  err: unknown,
  onError: ((error: unknown) => void) | undefined,
  headers?: Headers,
): Response {
  if (err instanceof AuthAiError) {
    const { code, message } = err.toJSON();
    return jsonResponse(
      { error: { code, message } },
      STATUS_BY_CODE[err.code] ?? 500,
      headers,
    );
  }
  onError?.(err);
  const { code, message } = ERR.SRV_001().toJSON();
  return jsonResponse({ error: { code, message } }, 500, headers);
}

// Control characters and backslashes make browsers read a "path" as another host.
const hasUnsafeCharacter = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return char === "\\" || code <= 0x1f || code === 0x7f;
  });

/**
 * A redirect target taken from a request, reduced to a same-origin path: an
 * absolute URL, a protocol-relative one (`//host`) or anything odd falls back
 * to `fallback`, so a login link cannot bounce users to another site.
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }
  if (hasUnsafeCharacter(candidate)) return fallback;
  const probe = new URL(candidate, "https://placeholder.invalid");
  if (probe.origin !== "https://placeholder.invalid") return fallback;
  return `${probe.pathname}${probe.search}${probe.hash}`;
}

/**
 * Refuses a state-changing request that a browser sent from another site.
 * Requests without `Origin` and `Sec-Fetch-Site` (non-browser clients) carry
 * no ambient cookie to abuse and pass.
 */
export function isCrossSite(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin !== expectedOrigin;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

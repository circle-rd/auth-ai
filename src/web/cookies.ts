import { ERR } from "../errors.js";

// Token characters only: the values handled here are base64url ids and compact JWEs.
const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;
const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;

export interface CookieOptions {
  /** Seconds; 0 expires the cookie at once. */
  readonly maxAgeSeconds: number;
  /** Adds `Secure` and the `__Host-` prefix, which pins the cookie to this host. */
  readonly secure: boolean;
}

/** Name of a cookie of the SDK: `__Host-` needs `Secure`, so it only applies over https. */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    // The first occurrence wins, as it is the one scoped most specifically.
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  if (!COOKIE_NAME.test(name.replace(/^__Host-/, ""))) {
    throw ERR.CFG_001("Invalid cookie name");
  }
  if (value !== "" && !COOKIE_VALUE.test(value)) {
    throw ERR.CFG_001("Invalid cookie value");
  }
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    // Lax still sends the cookie on the top-level GET that returns from the provider.
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}

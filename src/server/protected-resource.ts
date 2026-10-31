import type { AuthClient } from "../client.js";
import { ERR } from "../errors.js";

export interface ProtectedResourceMetadataOptions {
  /** The audience this API accepts: its RFC 8707 resource identifier. */
  readonly resource: string;
  readonly scopesSupported?: readonly string[];
}

export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly ["header"];
  readonly scopes_supported?: readonly string[];
}

/** RFC 9728 metadata, which lets MCP and OAuth clients find the authorization server. */
export function protectedResourceMetadata(
  auth: Pick<AuthClient, "config">,
  options: ProtectedResourceMetadataOptions,
): ProtectedResourceMetadata {
  return {
    resource: options.resource,
    authorization_servers: [auth.config.issuer],
    bearer_methods_supported: ["header"],
    ...(options.scopesSupported
      ? { scopes_supported: options.scopesSupported }
      : {}),
  };
}

/**
 * Where RFC 9728 §3 serves the metadata of `resource`: the well-known segment
 * sits between the host and the resource path.
 */
export function protectedResourceMetadataPath(resource: string): string {
  const { pathname } = new URL(resource);
  return `/.well-known/oauth-protected-resource${pathname === "/" ? "" : pathname}`;
}

export interface BearerChallengeOptions {
  /** Absolute URL of the metadata document, advertised to unauthenticated clients. */
  readonly resourceMetadataUrl: string;
  readonly error?: "invalid_token" | "insufficient_scope";
  readonly scope?: string;
}

const UNSAFE_PARAMETER = /["\\\r\n]/;

/** Value of the `WWW-Authenticate` header of a 401 or 403 response. */
export function bearerChallenge(options: BearerChallengeOptions): string {
  const parameters: [string, string][] = [
    ["resource_metadata", options.resourceMetadataUrl],
  ];
  if (options.error) parameters.push(["error", options.error]);
  if (options.scope) parameters.push(["scope", options.scope]);
  for (const [name, value] of parameters) {
    if (UNSAFE_PARAMETER.test(value)) {
      throw ERR.CFG_001(`Invalid ${name} in a Bearer challenge`);
    }
  }
  return `Bearer ${parameters.map(([name, value]) => `${name}="${value}"`).join(", ")}`;
}

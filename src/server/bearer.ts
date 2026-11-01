import { accessTokenClaimsSchema } from "../claims.js";
import type { AccessTokenClaims } from "../claims.js";
import type { AuthClient } from "../client.js";
import { ERR } from "../errors.js";
import { z } from "zod";

const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/** Extracts the token of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(
  authorization: string | null | undefined,
): string {
  const match = authorization ? BEARER_PATTERN.exec(authorization) : null;
  const token = match?.[1];
  if (!token) throw ERR.TOK_003();
  return token;
}

export interface VerifiedAccessToken {
  /** The end user, or `null` for a `client_credentials` token (machine call). */
  readonly userId: string | null;
  /** The OAuth client (application slug) the token was issued to. */
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly audiences: readonly string[];
  readonly claims: AccessTokenClaims;
}

export interface BearerVerifierOptions {
  /** The audience this API accepts: its RFC 8707 resource identifier. */
  readonly audience: string;
}

export interface BearerVerifier {
  /** Verifies a raw JWT access token. */
  verify(token: string): Promise<VerifiedAccessToken>;
  /** Verifies the token of an `Authorization` header. */
  verifyHeader(
    authorization: string | null | undefined,
  ): Promise<VerifiedAccessToken>;
}

const audienceSchema = z.url();

/**
 * Verifies JWT access tokens minted for this API (`aud` contains `audience`).
 * Opaque tokens are refused: they carry no audience this API could trust.
 */
export function createBearerVerifier(
  auth: Pick<AuthClient, "verifyJwt">,
  options: BearerVerifierOptions,
): BearerVerifier {
  const parsedAudience = audienceSchema.safeParse(options.audience);
  if (!parsedAudience.success) {
    throw ERR.CFG_001("audience must be the URL of this API");
  }
  const audience = parsedAudience.data;

  async function verify(token: string): Promise<VerifiedAccessToken> {
    if (token.split(".").length !== 3) {
      throw ERR.TOK_001("Only JWT access tokens are accepted");
    }
    const payload = await auth.verifyJwt(token, { audience });
    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw ERR.TOK_001("The access token is not bound to a client", {
        cause: claims.error,
      });
    }
    const { sub, azp, aud, scope } = claims.data;
    return {
      // For client_credentials tokens `sub` is the client id itself.
      userId: sub === azp ? null : sub,
      clientId: azp,
      scopes: scope ? scope.split(" ") : [],
      audiences: typeof aud === "string" ? [aud] : aud,
      claims: claims.data,
    };
  }

  return {
    verify,
    verifyHeader: async (authorization) =>
      verify(extractBearerToken(authorization)),
  };
}

/** Throws TOK_004 unless the token carries every listed scope. */
export function requireScopes(
  token: Pick<VerifiedAccessToken, "scopes">,
  ...required: string[]
): void {
  const missing = required.filter((scope) => !token.scopes.includes(scope));
  if (missing.length > 0) {
    throw ERR.TOK_004(`Missing required scope: ${missing.join(" ")}`, {
      details: { missing: missing.join(" ") },
    });
  }
}

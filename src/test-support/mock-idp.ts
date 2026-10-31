import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JWK, JWTPayload } from "jose";

export const ISSUER = "https://idp.test";
export const CLIENT_ID = "test-app";
export const CLIENT_SECRET = "test-secret";
export const REDIRECT_URI = "https://app.test/callback";

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly form: URLSearchParams;
}

export type TokenHandler = (
  request: RecordedRequest,
) => Response | Promise<Response>;

export interface MockIdp {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
  readonly metadata: Record<string, unknown>;
  tokenHandler: TokenHandler;
  revocationStatus: number;
  introspection: Record<string, unknown>;
  discoveryFailures: number;
  signJwt(
    claims: JWTPayload,
    options?: { typ?: string; key?: CryptoKey; kid?: string },
  ): Promise<string>;
  idToken(claims?: JWTPayload): Promise<string>;
  generateForeignKey(): Promise<CryptoKey>;
  requestsTo(path: string): RecordedRequest[];
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function createMockIdp(): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
  });
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: "key-1",
    alg: "EdDSA",
  };

  const metadata: Record<string, unknown> = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    introspection_endpoint: `${ISSUER}/introspect`,
    revocation_endpoint: `${ISSUER}/revoke`,
    end_session_endpoint: `${ISSUER}/end-session`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["EdDSA"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    authorization_response_iss_parameter_supported: true,
  };

  const requests: RecordedRequest[] = [];

  const idp: MockIdp = {
    requests,
    metadata,
    tokenHandler: () => jsonResponse({ error: "server_error" }, 500),
    revocationStatus: 200,
    introspection: { active: false },
    discoveryFailures: 0,
    requestsTo: (path) =>
      requests.filter((request) => request.url.pathname === path),

    async signJwt(claims, options = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({
          alg: "EdDSA",
          kid: options.kid ?? "key-1",
          ...(options.typ ? { typ: options.typ } : {}),
        })
        .sign(options.key ?? privateKey);
    },

    async idToken(claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      return idp.signJwt({
        iss: ISSUER,
        sub: "user-1",
        aud: CLIENT_ID,
        iat: now,
        exp: now + 300,
        ...claims,
      });
    },

    async generateForeignKey() {
      return (await generateKeyPair("EdDSA", { crv: "Ed25519" })).privateKey;
    },

    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      const headers = new Headers(init?.headers);
      const body = init?.body;
      const request: RecordedRequest = {
        method: init?.method ?? "GET",
        url,
        headers,
        form: new URLSearchParams(
          typeof body === "string" || body instanceof URLSearchParams
            ? body
            : undefined,
        ),
      };
      requests.push(request);

      switch (url.pathname) {
        case "/.well-known/openid-configuration":
          if (idp.discoveryFailures > 0) {
            idp.discoveryFailures -= 1;
            return new Response("unavailable", { status: 503 });
          }
          return jsonResponse(metadata);
        case "/jwks":
          return jsonResponse({ keys: [jwk] });
        case "/token":
          return idp.tokenHandler(request);
        case "/revoke":
          return new Response(null, { status: idp.revocationStatus });
        case "/introspect":
          return jsonResponse(idp.introspection);
        default:
          return new Response("not found", { status: 404 });
      }
    },
  };
  return idp;
}

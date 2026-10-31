import { beforeEach, describe, expect, it } from "vitest";
import { AuthAiError } from "../errors.js";
import {
  CLIENT_ID,
  ISSUER,
  createMockIdp,
  createTestAuth,
  nowSeconds,
} from "../test-support/mock-idp.js";
import type { MockIdp } from "../test-support/mock-idp.js";
import {
  createBearerVerifier,
  extractBearerToken,
  requireScopes,
} from "./bearer.js";
import type { BearerVerifier } from "./bearer.js";

const AUDIENCE = "https://api.app.test";

let idp: MockIdp;
let verifier: BearerVerifier;

beforeEach(async () => {
  idp = await createMockIdp();
  verifier = createBearerVerifier(createTestAuth(idp), { audience: AUDIENCE });
});

function accessToken(claims: Record<string, unknown> = {}): Promise<string> {
  const iat = nowSeconds();
  return idp.signJwt({
    iss: ISSUER,
    sub: "user-1",
    aud: [AUDIENCE, "https://llm.test"],
    azp: CLIENT_ID,
    scope: "openid roles",
    iat,
    exp: iat + 3600,
    roles: ["editor"],
    features: { maxProjects: 10 },
    ...claims,
  });
}

async function rejection(promise: Promise<unknown>): Promise<AuthAiError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthAiError);
  return err as AuthAiError;
}

describe("extractBearerToken", () => {
  it("extracts the token whatever the scheme case", () => {
    expect(extractBearerToken("Bearer a.b.c")).toBe("a.b.c");
    expect(extractBearerToken("bearer a.b.c")).toBe("a.b.c");
  });

  it.each([
    undefined,
    null,
    "",
    "Basic abc",
    "Bearer",
    "Bearer a b",
    "Token a.b.c",
  ])("rejects %j", (header) => {
    expect(() => extractBearerToken(header)).toThrowError(
      expect.objectContaining({ code: "TOK_003" }),
    );
  });
});

describe("createBearerVerifier", () => {
  it("returns the user, client, scopes and entitlements", async () => {
    const verified = await verifier.verify(await accessToken());
    expect(verified.userId).toBe("user-1");
    expect(verified.clientId).toBe(CLIENT_ID);
    expect(verified.scopes).toEqual(["openid", "roles"]);
    expect(verified.audiences).toEqual([AUDIENCE, "https://llm.test"]);
    expect(verified.claims.roles).toEqual(["editor"]);
    expect(verified.claims.features).toEqual({ maxProjects: 10 });
  });

  it("recognises a machine token by sub equal to azp", async () => {
    const verified = await verifier.verify(
      await accessToken({ sub: CLIENT_ID, aud: AUDIENCE, scope: undefined }),
    );
    expect(verified.userId).toBeNull();
    expect(verified.scopes).toEqual([]);
    expect(verified.audiences).toEqual([AUDIENCE]);
  });

  it("verifies the token of an Authorization header", async () => {
    const verified = await verifier.verifyHeader(
      `Bearer ${await accessToken()}`,
    );
    expect(verified.userId).toBe("user-1");
    expect((await rejection(verifier.verifyHeader(undefined))).code).toBe(
      "TOK_003",
    );
  });

  it("rejects a token minted for another audience", async () => {
    const err = await rejection(
      verifier.verify(await accessToken({ aud: "https://other.test" })),
    );
    expect(err.code).toBe("TOK_001");
  });

  it("rejects an expired token", async () => {
    const iat = nowSeconds() - 7200;
    const err = await rejection(
      verifier.verify(await accessToken({ iat, exp: iat + 3600 })),
    );
    expect(err.code).toBe("TOK_001");
  });

  it("rejects a token signed by an unknown key", async () => {
    const forged = await idp.signJwt(
      {
        iss: ISSUER,
        sub: "admin",
        aud: AUDIENCE,
        azp: CLIENT_ID,
        iat: nowSeconds(),
        exp: nowSeconds() + 3600,
      },
      { key: await idp.generateForeignKey() },
    );
    expect((await rejection(verifier.verify(forged))).code).toBe("TOK_001");
  });

  it("rejects a token from another issuer", async () => {
    const err = await rejection(
      verifier.verify(await accessToken({ iss: "https://evil.test" })),
    );
    expect(err.code).toBe("TOK_001");
  });

  it("rejects a token bound to no client", async () => {
    const err = await rejection(
      verifier.verify(await accessToken({ azp: undefined })),
    );
    expect(err.code).toBe("TOK_001");
  });

  it("rejects an opaque token without calling the provider", async () => {
    const err = await rejection(verifier.verify("opaque-token"));
    expect(err.code).toBe("TOK_001");
    expect(idp.requests).toHaveLength(0);
  });

  it("refuses a malformed audience at construction", () => {
    expect(() =>
      createBearerVerifier(createTestAuth(idp), { audience: "api" }),
    ).toThrowError(expect.objectContaining({ code: "CFG_001" }));
  });
});

describe("requireScopes", () => {
  it("passes when every scope is present", () => {
    expect(() => requireScopes({ scopes: ["a", "b"] }, "a", "b")).not.toThrow();
  });

  it("names the missing scopes", () => {
    expect(() => requireScopes({ scopes: ["a"] }, "a", "b", "c")).toThrowError(
      expect.objectContaining({
        code: "TOK_004",
        details: { missing: "b c" },
      }),
    );
  });
});

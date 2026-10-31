import { describe, expect, it } from "vitest";
import {
  createTestAuth,
  createMockIdp,
  ISSUER,
} from "../test-support/mock-idp.js";
import {
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
} from "./protected-resource.js";

describe("protectedResourceMetadata", () => {
  it("points at the provider as authorization server", async () => {
    const auth = createTestAuth(await createMockIdp());
    expect(
      protectedResourceMetadata(auth, {
        resource: "https://api.app.test",
        scopesSupported: ["openid", "roles"],
      }),
    ).toEqual({
      resource: "https://api.app.test",
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "roles"],
    });
  });

  it("omits scopes when none are declared", async () => {
    const auth = createTestAuth(await createMockIdp());
    expect(
      protectedResourceMetadata(auth, { resource: "https://api.app.test" }),
    ).not.toHaveProperty("scopes_supported");
  });
});

describe("protectedResourceMetadataPath", () => {
  it("inserts the well-known segment before the resource path", () => {
    expect(protectedResourceMetadataPath("https://api.app.test")).toBe(
      "/.well-known/oauth-protected-resource",
    );
    expect(protectedResourceMetadataPath("https://app.test/api/v1")).toBe(
      "/.well-known/oauth-protected-resource/api/v1",
    );
  });
});

describe("bearerChallenge", () => {
  const resourceMetadataUrl =
    "https://app.test/.well-known/oauth-protected-resource";

  it("advertises the metadata document", () => {
    expect(bearerChallenge({ resourceMetadataUrl })).toBe(
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
  });

  it("adds the error and scope", () => {
    expect(
      bearerChallenge({
        resourceMetadataUrl,
        error: "insufficient_scope",
        scope: "billing:read",
      }),
    ).toBe(
      `Bearer resource_metadata="${resourceMetadataUrl}", error="insufficient_scope", scope="billing:read"`,
    );
  });

  it("refuses a value that would break out of the header", () => {
    expect(() =>
      bearerChallenge({ resourceMetadataUrl, scope: 'a", error="none' }),
    ).toThrowError(expect.objectContaining({ code: "CFG_001" }));
  });
});

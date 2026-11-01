import { describe, expect, it } from "vitest";
import {
  getFeature,
  hasFeature,
  hasPermission,
  hasRole,
  idTokenClaimsSchema,
} from "./claims.js";

const base = { iss: "https://idp", sub: "u1", aud: "app", exp: 2, iat: 1 };

describe("idTokenClaimsSchema", () => {
  it("parses entitlement claims and keeps unknown ones", () => {
    const claims = idTokenClaimsSchema.parse({
      ...base,
      sid: "s1",
      roles: ["editor"],
      permissions: ["documents.write"],
      features: { maxProjects: 10, apiAccess: true, tier: "gold" },
      plan: "Premium",
      org_id: "org-1",
      custom: "kept",
    });
    expect(claims.org_id).toBe("org-1");
    expect(claims["custom"]).toBe("kept");
  });

  it("rejects a nested feature value", () => {
    expect(
      idTokenClaimsSchema.safeParse({ ...base, features: { a: { b: 1 } } })
        .success,
    ).toBe(false);
  });

  it("rejects claims without a subject", () => {
    const { sub: _sub, ...withoutSub } = base;
    expect(idTokenClaimsSchema.safeParse(withoutSub).success).toBe(false);
  });
});

describe("entitlement helpers", () => {
  const claims = {
    roles: ["editor"],
    permissions: ["reports", "documents.write"],
    features: { maxProjects: 10, apiAccess: false, beta: true, empty: "" },
  };

  it("checks roles", () => {
    expect(hasRole(claims, "editor")).toBe(true);
    expect(hasRole(claims, "admin")).toBe(false);
    expect(hasRole({}, "editor")).toBe(false);
  });

  it("treats write as implying read", () => {
    expect(hasPermission(claims, "reports")).toBe(true);
    expect(hasPermission(claims, "reports", "write")).toBe(false);
    expect(hasPermission(claims, "documents", "write")).toBe(true);
    expect(hasPermission(claims, "documents")).toBe(true);
    expect(hasPermission(claims, "billing")).toBe(false);
    expect(hasPermission({}, "reports")).toBe(false);
  });

  it("enables a feature unless absent, false, zero or empty", () => {
    expect(hasFeature(claims, "beta")).toBe(true);
    expect(hasFeature(claims, "maxProjects")).toBe(true);
    expect(hasFeature(claims, "apiAccess")).toBe(false);
    expect(hasFeature(claims, "empty")).toBe(false);
    expect(hasFeature(claims, "missing")).toBe(false);
    expect(hasFeature({}, "beta")).toBe(false);
  });

  it("reads a feature value", () => {
    expect(getFeature(claims, "maxProjects")).toBe(10);
    expect(getFeature(claims, "missing")).toBeUndefined();
  });
});

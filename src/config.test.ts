import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPES, parseAuthClientConfig } from "./config.js";
import { AuthAiError } from "./errors.js";

const valid = {
  issuer: "https://auth.example.com",
  clientId: "my-app",
  redirectUri: "https://app.example.com/callback",
};

function rejection(input: unknown): AuthAiError {
  try {
    parseAuthClientConfig(input);
  } catch (err) {
    if (err instanceof AuthAiError) return err;
    throw err;
  }
  throw new Error("expected the configuration to be rejected");
}

describe("parseAuthClientConfig", () => {
  it("applies the documented defaults", () => {
    const config = parseAuthClientConfig(valid);
    expect(config.scopes).toEqual([...DEFAULT_SCOPES]);
    expect(config.resources).toEqual([]);
    expect(config.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(config.clockToleranceSeconds).toBe(5);
    expect(config.timeoutMs).toBe(10_000);
    expect(config.clientSecret).toBeUndefined();
  });

  it("accepts an http redirect URI on loopback only", () => {
    expect(
      parseAuthClientConfig({
        ...valid,
        redirectUri: "http://localhost:3000/callback",
      }).redirectUri,
    ).toBe("http://localhost:3000/callback");
    expect(
      rejection({ ...valid, redirectUri: "http://app.example.com/callback" })
        .code,
    ).toBe("CFG_001");
  });

  it.each([
    ["an http issuer", { issuer: "http://auth.example.com" }],
    [
      "an issuer with a trailing slash",
      { issuer: "https://auth.example.com/" },
    ],
    ["scopes without openid", { scopes: ["profile"] }],
    ["a non-URL resource", { resources: ["not a url"] }],
    ["an empty client id", { clientId: "" }],
    ["an unknown auth method", { tokenEndpointAuthMethod: "none" }],
  ])("rejects %s", (_label, override) => {
    const err = rejection({ ...valid, ...override });
    expect(err.code).toBe("CFG_001");
    expect(err.message).toContain(Object.keys(override)[0]);
  });

  it("names every missing field and never echoes the secret", () => {
    const err = rejection({ clientSecret: "super-secret-value" });
    expect(err.message).toContain("issuer");
    expect(err.message).toContain("clientId");
    expect(err.message).toContain("redirectUri");
    expect(err.message).not.toContain("super-secret-value");
  });
});

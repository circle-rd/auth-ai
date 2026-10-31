import { describe, expect, it } from "vitest";
import { AuthAiError, ERR } from "./errors.js";

describe("AuthAiError", () => {
  it("serialises code and message without details by default", () => {
    const err = ERR.CFG_001();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthAiError);
    expect(err.toJSON()).toEqual({
      code: "CFG_001",
      message: "Invalid SDK configuration",
    });
  });

  it("keeps custom message, details and cause", () => {
    const cause = new Error("root");
    const err = ERR.CFG_001("issuer must be https", {
      details: { field: "issuer" },
      cause,
    });
    expect(err.message).toBe("issuer must be https");
    expect(err.cause).toBe(cause);
    expect(err.toJSON()).toEqual({
      code: "CFG_001",
      message: "issuer must be https",
      details: { field: "issuer" },
    });
  });
});

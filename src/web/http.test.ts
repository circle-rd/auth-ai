import { describe, expect, it, vi } from "vitest";
import { ERR } from "../errors.js";
import {
  errorResponse,
  isCrossSite,
  redirectResponse,
  safeRedirectPath,
} from "./http.js";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/a/b?x=1&y=2#top", "/a/b?x=1&y=2#top"],
    ["/", "/"],
  ])("keeps %s", (input, output) => {
    expect(safeRedirectPath(input, "/fallback")).toBe(output);
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "//evil.test",
    "//evil.test/path",
    "https://evil.test",
    "javascript:alert(1)",
    "/\\evil.test",
    "/\t/evil.test",
    "/%0d%0aSet-Cookie:x=1/\r\n",
    "/a\nb",
    "/\u007f",
  ])("falls back for %j", (input) => {
    expect(safeRedirectPath(input, "/fallback")).toBe("/fallback");
  });

  it("does not let an encoded slash pair escape the origin", () => {
    const result = safeRedirectPath("/%2F%2Fevil.test", "/fallback");
    expect(new URL(result, "https://app.test").origin).toBe("https://app.test");
  });
});

describe("isCrossSite", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://app.test/auth/logout", { method: "POST", headers });

  it("accepts the same origin", () => {
    expect(
      isCrossSite(request({ origin: "https://app.test" }), "https://app.test"),
    ).toBe(false);
  });

  it("refuses another origin, even when Sec-Fetch-Site says same-origin", () => {
    expect(
      isCrossSite(
        request({
          origin: "https://evil.test",
          "sec-fetch-site": "same-origin",
        }),
        "https://app.test",
      ),
    ).toBe(true);
  });

  it("falls back on Sec-Fetch-Site without an Origin", () => {
    expect(
      isCrossSite(
        request({ "sec-fetch-site": "cross-site" }),
        "https://app.test",
      ),
    ).toBe(true);
    expect(
      isCrossSite(
        request({ "sec-fetch-site": "same-site" }),
        "https://app.test",
      ),
    ).toBe(true);
    expect(
      isCrossSite(
        request({ "sec-fetch-site": "same-origin" }),
        "https://app.test",
      ),
    ).toBe(false);
    expect(
      isCrossSite(request({ "sec-fetch-site": "none" }), "https://app.test"),
    ).toBe(false);
  });

  it("lets non-browser clients through", () => {
    expect(isCrossSite(request({}), "https://app.test")).toBe(false);
  });
});

describe("errorResponse", () => {
  it("serialises an SDK error with its status", async () => {
    const response = errorResponse(ERR.SES_001(), undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "SES_001", message: "Not signed in" },
    });
  });

  it.each([
    [ERR.SES_002(), 400],
    [ERR.SES_004(), 403],
    [ERR.TOK_001(), 401],
    [ERR.OIDC_003(), 502],
    [ERR.CFG_001(), 500],
  ])("maps %s to HTTP %s", (err, status) => {
    expect(errorResponse(err, undefined).status).toBe(status);
  });

  it("hides an unexpected failure and reports it", async () => {
    const onError = vi.fn();
    const response = errorResponse(new Error("db password=hunter2"), onError);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not report an SDK error twice", () => {
    const onError = vi.fn();
    errorResponse(ERR.SES_001(), onError);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("redirectResponse", () => {
  it("sets the location and forbids caching", () => {
    const response = redirectResponse("/next", 303);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/next");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

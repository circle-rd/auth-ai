import { describe, expect, it } from "vitest";
import {
  clearCookie,
  cookieName,
  parseCookies,
  serializeCookie,
} from "./cookies.js";

describe("cookieName", () => {
  it("adds the __Host- prefix only over https", () => {
    expect(cookieName("aai_session", true)).toBe("__Host-aai_session");
    expect(cookieName("aai_session", false)).toBe("aai_session");
  });
});

describe("parseCookies", () => {
  it("reads every cookie and keeps the first of a duplicate", () => {
    const cookies = parseCookies("a=1; b=two=2;  c=3; a=other; broken");
    expect(Object.fromEntries(cookies)).toEqual({ a: "1", b: "two=2", c: "3" });
  });

  it("tolerates a missing header", () => {
    expect(parseCookies(null).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
  });
});

describe("serializeCookie", () => {
  it("builds a hardened cookie", () => {
    expect(
      serializeCookie("__Host-aai_session", "abc.DEF-_~1", {
        maxAgeSeconds: 3600.9,
        secure: true,
      }),
    ).toBe(
      "__Host-aai_session=abc.DEF-_~1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure",
    );
  });

  it("omits Secure over plain http for local development", () => {
    expect(
      serializeCookie("aai_session", "v", { maxAgeSeconds: 1, secure: false }),
    ).not.toContain("Secure");
  });

  it.each(["a;b", "a b", "a,b", 'a"b', "a\r\nSet-Cookie: x=1", "é"])(
    "refuses the value %j",
    (value) => {
      expect(() =>
        serializeCookie("aai", value, { maxAgeSeconds: 1, secure: true }),
      ).toThrowError(expect.objectContaining({ code: "CFG_001" }));
    },
  );

  it("refuses an invalid name", () => {
    expect(() =>
      serializeCookie("a;b", "v", { maxAgeSeconds: 1, secure: true }),
    ).toThrowError(expect.objectContaining({ code: "CFG_001" }));
  });

  it("clears a cookie by expiring it", () => {
    expect(clearCookie("aai_session", false)).toBe(
      "aai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("never goes below zero seconds", () => {
    expect(
      serializeCookie("aai", "v", { maxAgeSeconds: -5, secure: false }),
    ).toContain("Max-Age=0");
  });
});

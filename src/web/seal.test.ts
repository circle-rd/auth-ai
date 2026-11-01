import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { deriveSealKey, seal, unseal } from "./seal.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const schema = z.object({ state: z.string(), n: z.number() });

describe("seal", () => {
  it("round-trips a value", async () => {
    const key = await deriveSealKey(SECRET);
    const token = await seal(key, { state: "s", n: 1 }, 60);
    expect(token).not.toContain("state");
    expect(await unseal(key, token, schema)).toEqual({ state: "s", n: 1 });
  });

  it("derives a stable 256-bit key", async () => {
    const key = await deriveSealKey(SECRET);
    expect(key).toHaveLength(32);
    expect(await deriveSealKey(SECRET)).toEqual(key);
    expect(await deriveSealKey(`${SECRET}x`)).not.toEqual(key);
  });

  it("refuses a short secret without echoing it", async () => {
    const err = await deriveSealKey("short").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "CFG_001" });
    expect(String((err as Error).message)).not.toContain("short");
  });

  it("rejects a token sealed with another key", async () => {
    const token = await seal(
      await deriveSealKey(SECRET),
      { state: "s", n: 1 },
      60,
    );
    await expect(
      unseal(
        await deriveSealKey("another-secret-another-secret-12"),
        token,
        schema,
      ),
    ).rejects.toMatchObject({ code: "SES_002" });
  });

  it("rejects a tampered token", async () => {
    const key = await deriveSealKey(SECRET);
    const token = await seal(key, { state: "s", n: 1 }, 60);
    const tampered = `${token.slice(0, -2)}${token.endsWith("A") ? "B" : "A"}x`;
    await expect(unseal(key, tampered, schema)).rejects.toMatchObject({
      code: "SES_002",
    });
    await expect(unseal(key, "not-a-token", schema)).rejects.toMatchObject({
      code: "SES_002",
    });
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 31, 8, 0, 0) });
    try {
      const key = await deriveSealKey(SECRET);
      const token = await seal(key, { state: "s", n: 1 }, 60);
      vi.setSystemTime(Date.now() + 61_000);
      await expect(unseal(key, token, schema)).rejects.toMatchObject({
        code: "SES_002",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a payload that does not match the schema", async () => {
    const key = await deriveSealKey(SECRET);
    const token = await seal(key, { state: 1 }, 60);
    await expect(unseal(key, token, schema)).rejects.toMatchObject({
      code: "SES_002",
    });
  });

  it("rejects a token sealed with another algorithm", async () => {
    const key = await deriveSealKey(SECRET);
    const { CompactEncrypt } = await import("jose");
    const foreign = await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify({ data: { state: "s", n: 1 } })),
    )
      .setProtectedHeader({ alg: "dir", enc: "A128GCM" })
      .encrypt(key.slice(0, 16));
    await expect(unseal(key, foreign, schema)).rejects.toMatchObject({
      code: "SES_002",
    });
  });
});

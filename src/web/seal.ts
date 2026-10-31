import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { ERR } from "../errors.js";

const MIN_SECRET_LENGTH = 32;

/**
 * Derives the AES-256 key sealing the short-lived cookies from the
 * application's secret. The secret must be long and random (for example 32
 * bytes of base64): it is never stored or logged.
 */
export async function deriveSealKey(secret: string): Promise<Uint8Array> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw ERR.CFG_001(
      `The secret must be at least ${MIN_SECRET_LENGTH} characters long`,
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`auth-ai:seal:${secret}`),
  );
  return new Uint8Array(digest);
}

const envelopeSchema = z.object({ data: z.unknown() });

/** Encrypts and authenticates a JSON value into a compact token that expires. */
export async function seal(
  key: Uint8Array,
  data: unknown,
  ttlSeconds: number,
): Promise<string> {
  return new EncryptJWT({ data })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(key);
}

/** The value of `seal`, validated by `schema`; SES_002 for any tampered or expired token. */
export async function unseal<T>(
  key: Uint8Array,
  token: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const { payload } = await jwtDecrypt(token, key, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const envelope = envelopeSchema.parse(payload);
    return schema.parse(envelope.data);
  } catch (err) {
    throw ERR.SES_002(undefined, { cause: err });
  }
}

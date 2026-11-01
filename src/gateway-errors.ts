import { z } from "zod";
import { AuthAiError, ERR } from "./errors.js";

const gatewayErrorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
  }),
});

/**
 * Maps a failed gateway answer to the SDK registry. Branch on the status first:
 * LiteLLM serialises the final body itself, so only the status is a contract.
 * The message is the gateway's own and carries no credential.
 */
export function toGatewayError(
  status: number,
  body: unknown,
  headers?: Headers,
): AuthAiError {
  const parsed = gatewayErrorBodySchema.safeParse(body);
  const type = parsed.success ? parsed.data.error.type : undefined;
  const message = parsed.success ? parsed.data.error.message : undefined;
  const details: Record<string, string | number> = { status };
  if (type) details["type"] = type;

  const retryAfter = Number(headers?.get("retry-after"));
  if (status === 429 && Number.isFinite(retryAfter) && retryAfter >= 0) {
    details["retryAfterSeconds"] = retryAfter;
  }

  if (status === 402) return ERR.GW_001(message, { details });
  if (status === 429) return ERR.GW_002(message, { details });
  if (status === 401 || status === 403) return ERR.GW_003(message, { details });
  if (status === 503) return ERR.GW_004(message, { details });
  return ERR.GW_005(message ?? `The gateway answered ${status}`, { details });
}

/** True for the error of a call refused because the wallet is empty. */
export function isInsufficientCredit(err: unknown): boolean {
  return err instanceof AuthAiError && err.code === "GW_001";
}

/**
 * Same test for the error of an OpenAI-compatible SDK, which exposes the HTTP
 * status as `status`: the gateway answers 402 when the balance is zero or negative.
 */
export function isInsufficientCreditStatus(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 402
  );
}

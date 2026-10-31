import { z } from "zod";
import { ERR } from "./errors.js";

export const DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "roles",
  "permissions",
  "features",
  "offline_access",
] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const issuerSchema = z
  .url({ protocol: /^https$/ })
  .refine((value) => !value.endsWith("/"), {
    message: "must not end with a slash: it is compared verbatim to `iss`",
  });

// http is allowed for loopback only, so local development needs no tunnel.
const redirectUriSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  },
  { message: "must be https (http is only accepted for localhost)" },
);

export const authClientConfigSchema = z.object({
  issuer: issuerSchema,
  clientId: z.string().min(1),
  // Absent for a public client, which then relies on PKCE alone.
  clientSecret: z.string().min(1).optional(),
  tokenEndpointAuthMethod: z
    .enum(["client_secret_basic", "client_secret_post"])
    .default("client_secret_basic"),
  redirectUri: redirectUriSchema,
  postLogoutRedirectUri: redirectUriSchema.optional(),
  scopes: z
    .array(z.string().min(1))
    .refine((scopes) => scopes.includes("openid"), {
      message: "must include `openid`",
    })
    .default([...DEFAULT_SCOPES]),
  // RFC 8707 audiences requested at sign-in; each refresh narrows to one.
  resources: z.array(z.url()).default([]),
  clockToleranceSeconds: z.number().int().min(0).max(300).default(5),
  timeoutMs: z.number().int().positive().default(10_000),
});

export type AuthClientConfig = z.input<typeof authClientConfigSchema>;
export type ResolvedAuthClientConfig = z.output<typeof authClientConfigSchema>;

export function parseAuthClientConfig(
  input: unknown,
): ResolvedAuthClientConfig {
  const result = authClientConfigSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw ERR.CFG_001(`Invalid SDK configuration: ${issues}`, {
    cause: result.error,
  });
}

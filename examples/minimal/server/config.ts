import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.url(),
  AUTH_ISSUER: z.url(),
  AUTH_CLIENT_ID: z.string().min(1),
  AUTH_CLIENT_SECRET: z.string().min(1),
  GATEWAY_URL: z.url(),
  COOKIE_SECRET: z.string().min(32),
});

export type Config = z.infer<typeof envSchema>;

/** Fails at startup, naming the offending variables and never their values. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid environment: ${names}`);
  }
  return result.data;
}

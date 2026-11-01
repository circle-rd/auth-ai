import { z } from "zod";
import type { IdTokenClaims } from "./claims.js";

const featureValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * What a signed-in user looks like to the application's frontend: profile and
 * entitlements, with the absent claims normalised to empty values. Tokens,
 * `sid` and timestamps never reach the browser.
 */
export const sessionUserSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  picture: z.string().optional(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  features: z.record(z.string(), featureValueSchema),
  plan: z.string().optional(),
  orgId: z.string().optional(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export function toSessionUser(claims: IdTokenClaims): SessionUser {
  return {
    sub: claims.sub,
    roles: claims.roles ?? [],
    permissions: claims.permissions ?? [],
    features: claims.features ?? {},
    ...(claims.name === undefined ? {} : { name: claims.name }),
    ...(claims.email === undefined ? {} : { email: claims.email }),
    ...(claims.email_verified === undefined
      ? {}
      : { emailVerified: claims.email_verified }),
    ...(claims.picture === undefined ? {} : { picture: claims.picture }),
    ...(claims.plan === undefined ? {} : { plan: claims.plan }),
    ...(claims.org_id === undefined ? {} : { orgId: claims.org_id }),
  };
}

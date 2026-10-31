import { z } from "zod";

const featureValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const audienceSchema = z.union([z.string(), z.array(z.string())]);

/**
 * Claims of an ID token issued by auth-service. Unknown claims are kept as is.
 * `roles`, `permissions`, `features`, `plan` and `org_id` only exist when the
 * matching scope was granted.
 */
export const idTokenClaimsSchema = z.looseObject({
  iss: z.string(),
  sub: z.string(),
  aud: audienceSchema,
  exp: z.number(),
  iat: z.number(),
  sid: z.string().optional(),
  azp: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  company: z.string().optional(),
  updated_at: z.number().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  phone_number: z.string().optional(),
  roles: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  features: z.record(z.string(), featureValueSchema).optional(),
  plan: z.string().optional(),
  org_id: z.string().optional(),
});

export type FeatureValue = z.infer<typeof featureValueSchema>;
export type IdTokenClaims = z.infer<typeof idTokenClaimsSchema>;

export type PermissionAction = "read" | "write";

type EntitlementClaims = Pick<
  IdTokenClaims,
  "roles" | "permissions" | "features"
>;

export function hasRole(claims: EntitlementClaims, role: string): boolean {
  return claims.roles?.includes(role) ?? false;
}

/**
 * `resource` grants read access and `resource.write` grants write access,
 * which also implies read: auth-service keeps only the highest action.
 */
export function hasPermission(
  claims: EntitlementClaims,
  resource: string,
  action: PermissionAction = "read",
): boolean {
  const permissions = claims.permissions;
  if (!permissions) return false;
  if (permissions.includes(`${resource}.write`)) return true;
  return action === "read" && permissions.includes(resource);
}

/** A feature is enabled when present and neither `false` nor `0` nor `""`. */
export function hasFeature(claims: EntitlementClaims, key: string): boolean {
  const value = claims.features?.[key];
  return value !== undefined && value !== false && value !== 0 && value !== "";
}

export function getFeature(
  claims: EntitlementClaims,
  key: string,
): FeatureValue | undefined {
  return claims.features?.[key];
}

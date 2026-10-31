import { z } from "zod";

export const introspectionSchema = z.looseObject({
  active: z.boolean(),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  sub: z.string().optional(),
  username: z.string().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
});

export type IntrospectionResult = z.infer<typeof introspectionSchema>;

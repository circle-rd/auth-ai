import { z } from "zod";
import type { AiClient } from "../ai.js";
import { ERR } from "../errors.js";
import { jsonResponse } from "./http.js";
import type { Session } from "./sessions.js";

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export type RouteHandler = (request: Request) => Promise<Response>;

/**
 * Wallet and model reads for the application's own frontend, which holds no
 * token: the backend calls auth-service and the gateway on the user's behalf.
 */
export function createAiRoutes(
  ai: AiClient,
  requireSession: (request: Request) => Promise<Session>,
): Record<string, RouteHandler> {
  return {
    "/wallet": async (request) => {
      const { userId } = await requireSession(request);
      const { wallet } = ai.forUser(userId);
      return jsonResponse({
        ...(await wallet.getAccount()),
        topupUrl: wallet.topupUrl(),
      });
    },
    "/wallet/stats": async (request) => {
      const { userId } = await requireSession(request);
      const query = statsQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!query.success) throw ERR.REQ_001();
      const { days } = query.data;
      return jsonResponse(
        await ai
          .forUser(userId)
          .wallet.getStats(days === undefined ? {} : { days }),
      );
    },
    "/models": async (request) => {
      const { userId } = await requireSession(request);
      return jsonResponse({
        models: await ai.forUser(userId).gateway.listModels(),
      });
    },
  };
}

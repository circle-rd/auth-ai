import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { ERR } from "../errors.js";
import type { AuthHandlers } from "../web/handlers.js";
import { errorResponse } from "../web/http.js";
import type { Session } from "../web/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth` and `loadSession`; null when signed out. */
    authSession: Session | null;
  }
}

export interface AuthPluginOptions {
  readonly handlers: AuthHandlers;
}

// A Web Request is built on the registered origin: the Host header is not trusted.
function toWebRequest(request: FastifyRequest, origin: string): Request | null {
  const path = request.raw.url ?? "/";
  if (!path.startsWith("/")) return null;

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    // HTTP/2 pseudo-headers are not valid Headers names.
    if (name.startsWith(":") || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(`${origin}${path}`, {
    method: request.method,
    headers,
    ...(hasBody && typeof request.body === "string"
      ? { body: request.body }
      : {}),
  });
}

async function send(reply: FastifyReply, response: Response): Promise<void> {
  reply.status(response.status);
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") void reply.header(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) void reply.header("set-cookie", cookies);
  const body = await response.text();
  await (body === "" ? reply.send() : reply.send(body));
}

/**
 * Serves the sign-in routes below `handlers.basePath` and decorates requests
 * with `authSession`. Register it once; protect routes with `requireAuth`.
 */
export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  { handlers },
) => {
  fastify.decorateRequest("authSession", null);

  // Scoped: the back-channel endpoint receives a form, which Fastify does not parse by default,
  // and an application's own parser must not clash with this one.
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 16_384 },
      (_request, body, done) => done(null, body),
    );
    scope.all(`${handlers.basePath}/*`, async (request, reply) => {
      const webRequest = toWebRequest(request, handlers.origin);
      const response = webRequest ? await handlers.handle(webRequest) : null;
      if (!response) return reply.callNotFound();
      return send(reply, response);
    });
  });
};

// Without it the decorator is scoped to the plugin and invisible to the application's routes.
(authPlugin as unknown as Record<symbol, boolean>)[
  Symbol.for("skip-override")
] = true;

async function fail(reply: FastifyReply, err: unknown): Promise<FastifyReply> {
  await send(reply, errorResponse(err, undefined));
  return reply;
}

/** Answers 401 `SES_001` to signed-out requests, and sets `request.authSession` for the others. */
export function requireAuth(
  handlers: AuthHandlers,
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    try {
      const webRequest = toWebRequest(request, handlers.origin);
      if (!webRequest) throw ERR.SES_001();
      request.authSession = await handlers.requireSession(webRequest);
    } catch (err) {
      return fail(reply, err);
    }
  };
}

/** Sets `request.authSession` when signed in and leaves it null otherwise. */
export function loadSession(
  handlers: AuthHandlers,
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    try {
      const webRequest = toWebRequest(request, handlers.origin);
      request.authSession = webRequest
        ? await handlers.getSession(webRequest)
        : null;
    } catch (err) {
      return fail(reply, err);
    }
  };
}

# @circle-rd/auth-ai

TypeScript SDK for applications that rely on the CIRCLE
[auth-service](https://github.com/circle-rd/auth-service) identity provider:
OAuth 2.1 / OIDC sign-in, enriched claims (roles, organisation, features),
billing and consumption, wallet, LiteLLM gateway and back-channel logout.

> Work in progress: the public API is not stable yet.

## Quick start (Fastify backend)

```ts
import Fastify from "fastify";
import {
  createAuthClient,
  createAiClient,
  GrantManager,
} from "@circle-rd/auth-ai";
import { createAuthHandlers } from "@circle-rd/auth-ai/web";
import { authPlugin, requireAuth } from "@circle-rd/auth-ai/fastify";

const auth = createAuthClient({
  issuer: "https://auth.example.com",
  clientId: "my-app",
  clientSecret: process.env.AUTH_CLIENT_SECRET,
  redirectUri: "https://app.example.com/auth/callback",
  // Switch on LiteLLM support for the application, then:
  gatewayUrl: "https://llm.example.com",
});

// Implement GrantStore and SessionStore on your database for production.
const grants = new GrantManager({ auth, store: grantStore });
const handlers = await createAuthHandlers({
  auth,
  grants,
  sessions: sessionStore,
  secret: process.env.AUTH_COOKIE_SECRET, // 32+ random characters
});

const app = Fastify();
await app.register(authPlugin, { handlers }); // /auth/login, /callback, /me, /logout, /backchannel-logout
app.get("/api/models", { preHandler: requireAuth(handlers) }, async (request) =>
  createAiClient({ auth, grants })
    .forUser(request.authSession!.userId)
    .gateway.listModels(),
);
```

Register `https://app.example.com/auth/backchannel-logout` as the application's
back-channel logout URI, and enable end-session on it: the sign-in refuses an
ID token without `sid`.

## Development

Requires Node.js 22 and pnpm (the version is pinned by `packageManager`).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:coverage
pnpm build
```

## Releases

| Channel   | Trigger                              | npm dist-tag |
| --------- | ------------------------------------ | ------------ |
| `nightly` | Manual run of the _Nightly_ workflow | `nightly`    |
| `latest`  | Push of a `vX.Y.Z` tag from `main`   | `latest`     |

A nightly is published as `X.Y.Z-nightly.<date>.g<sha>` without any commit,
and the previous nightly is deprecated. The `NPM_TOKEN` repository secret is
required by both publishing workflows.

## License

[MIT](LICENSE)

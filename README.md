# @circle-rd/auth-ai

TypeScript SDK for applications that rely on the CIRCLE
[auth-service](https://github.com/circle-rd/auth-service) identity provider:
OAuth 2.1 / OIDC sign-in, enriched claims (roles, organisation, features),
billing and consumption, wallet, LiteLLM gateway and back-channel logout.

> Work in progress: the public API is not stable yet.

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

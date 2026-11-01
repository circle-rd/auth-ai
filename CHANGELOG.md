# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Sections, when present, appear in this order: `Added`, `Changed`, `Removed`,
`Fixed`, `Security`. Per our no-backward-compatibility policy
([CONTRIBUTING.md](CONTRIBUTING.md#2-versioning-and-breaking-changes)) there is no
`Deprecated` section: incompatible changes go straight to `Removed` and bump the version.

## [Unreleased]

<!-- Add user-visible changes here. Move to a dated section at release time. -->

## [0.1.0] - Unreleased

First release.

### Added

- **Publishing**: a GitHub release `vX.Y.Z` created from `main` publishes `latest`
  (`next` for a pre-release); a manual _Nightly_ run publishes `nightly`. Both use
  npm Trusted Publishing (OIDC) with provenance, no stored npm token.
- **Core (`@circle-rd/auth-ai`)**: `createAuthClient` (discovery cache, PKCE login,
  callback with ID-token verification, refresh with RFC 8707 resource narrowing,
  logout URL, revoke, introspect, `client_credentials`), `GrantManager` (serialized
  refresh-token rotation, per-audience access tokens, pluggable `GrantStore` and
  `GrantLock`), typed claims with `hasRole` / `hasPermission` / `hasFeature` /
  `getFeature`, the error registry (`CFG_`, `OIDC_`, `TOK_`, `API_`, `GW_`, `SES_`,
  `REQ_`, `SRV_`) with `toPublicJSON()`.
- **Wallet and gateway**: `WalletClient` (balance, statistics, per-session usage,
  transactions, top-up options and link; `bigint` micro-euros, `formatEuros`),
  `GatewayClient` (origin-locked `fetch`, OpenAI-compatible base URL, models, agents,
  MCP servers, MCP URLs, `postJson`, gateway error mapping), `createAiClient().forUser()`,
  and the `gatewayUrl` option that adds the gateway and auth-service audiences and the
  `wallet:self:read` scope.
- **Server (`/server`)**: Bearer-token verifier, back-channel logout handler with replay
  protection, RFC 9728 protected-resource metadata and `WWW-Authenticate` challenges,
  machine API (subscription, metered usage, invoices, consumption reporting).
- **Backend-for-frontend (`/web`, `/fastify`)**: `createAuthHandlers` (`/login`,
  `/callback`, `/me`, `/logout`, `/backchannel-logout`, optional `/wallet`,
  `/wallet/stats`, `/models`), sealed one-shot login cookie, hashed session ids,
  `SessionStore` contract, scheduled claims renewal; Fastify plugin with `requireAuth`
  and `loadSession`.
- **Frontend (`/client`, `/react`, `/vue`)**: cookie-only browser client, observable
  stores, React hooks and Vue composables.
- Example application (`examples/minimal`) with an end-to-end self-test, and the
  Docus documentation site.

### Security

- Every failed sign-in callback answers one generic `403 SES_005`; messages and details
  stay in the application's logs.
- `__Host-` cookies, same-origin redirect targets, refused cross-site logout, URLs built
  on the registered origin, Fastify >= 5.12.6 required.

[Unreleased]: https://github.com/circle-rd/auth-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/circle-rd/auth-ai/releases/tag/v0.1.0

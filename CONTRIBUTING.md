# Contributing to auth-ai

> Welcome — this document covers contributor onboarding, versioning policy,
> releases and the Git workflow. **All technical standards** (TypeScript,
> architecture, testing, error handling, security) live in
> [AGENTS.md](AGENTS.md) and are the canonical reference. Read both documents
> before opening a PR.

---

## 1. Development environment

### Prerequisites

- Node.js 22+
- pnpm 10+ (the exact version is pinned by `packageManager`)
- Docker (optional: to build the example app and the documentation image)

### First-time setup

```bash
pnpm install
pnpm test          # unit suite, no network
```

The unit tests run against an in-memory mock identity provider
(`src/test-support/mock-idp.ts`): no auth-service instance is needed.

### Daily commands

For the full command table see [AGENTS.md → Build & Test Commands](AGENTS.md#build--test-commands).

| Command              | When to run                   |
| -------------------- | ----------------------------- |
| `pnpm test:watch`    | While developing              |
| `pnpm typecheck`     | Before committing             |
| `pnpm test:coverage` | Before opening a PR           |
| `pnpm format`        | To fix formatting             |
| `pnpm example:build` | After changing the public API |

### End-to-end check

`examples/minimal` is a deployable application whose **Self-test** button exercises
every brick against a real auth-service. Run it when a change touches sign-in,
tokens, the wallet or the gateway (see its README).

### Documentation

The documentation site lives in `docs-site/` (Docus). Build it in Docker:

```bash
docker build -t auth-ai-docs ./docs-site
```

---

## 2. Versioning and breaking changes

This project follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`). While the major
version is `0`, a breaking change bumps `MINOR`.

| Change type                      | Version bump | Required action        |
| -------------------------------- | ------------ | ---------------------- |
| Bug fix, no API change           | `PATCH`      | Changelog entry        |
| New feature, backward-compatible | `MINOR`      | Changelog entry + docs |
| Breaking change                  | `MAJOR`      | See below              |

### Breaking changes

A breaking change is anything that alters the public contract: a changed signature or
default, a removed export, a changed error code or response shape, a raised peer
dependency range.

**The rule: no backward-compatibility shims.** Bump the version, document the change
and a migration note in `CHANGELOG.md` and the docs, and remove the old behaviour.

---

## 3. Releases

| Channel   | Trigger                                                 | npm dist-tag |
| --------- | ------------------------------------------------------- | ------------ |
| `nightly` | Manual run of the _Nightly_ workflow (`develop`/`main`) | `nightly`    |
| `latest`  | A GitHub release `vX.Y.Z` created from `main`           | `latest`     |

1. Merge `develop` into `main` through a pull request.
2. Set `version` in `package.json`, move the `[Unreleased]` entries of
   `CHANGELOG.md` under the new version, commit on `main`.
3. Create the GitHub release (and its tag `vX.Y.Z`) from `main`: this is the only
   trigger. The _Release_ workflow runs the quality gates, checks that the tag
   matches `package.json` and publishes with provenance. It never creates a release
   or a tag itself. A pre-release version (`X.Y.Z-rc.1`) needs a release marked
   _pre-release_ and is published under the `next` dist-tag.
4. Merge `main` back into `develop`.

If a release run fails, fix the cause, then delete the release **and** its tag and
create them again: re-running a job of a deleted tag fails at checkout.

A nightly is published as `X.Y.Z-nightly.<date>.g<sha>` without any commit (`X.Y.Z`
is the next patch when `package.json` holds an already published version). Nightlies
are not deprecated automatically: that needs a token, and Trusted Publishing covers
publishing only.

Both workflows publish through npm Trusted Publishing (OIDC): no npm token is stored.
Each one must stay registered as a trusted publisher on npmjs.com, which binds the
workflow file name.

---

## 4. Git workflow

### Branch naming

| Type          | Pattern                        | Example                    |
| ------------- | ------------------------------ | -------------------------- |
| Feature       | `feat/<short-description>`     | `feat/hono-adapter`        |
| Bug fix       | `fix/<short-description>`      | `fix/refresh-lock`         |
| Refactor      | `refactor/<short-description>` | `refactor/session-store`   |
| Chore / infra | `chore/<short-description>`    | `chore/update-vitest`      |
| Breaking      | `breaking/<short-description>` | `breaking/handler-options` |

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer: BREAKING CHANGE, Closes #issue]
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `build`, `ci`.

```
feat(web): answer every failed callback with one generic 403
fix(grants): keep the grant when the provider is unreachable
docs(guides): add the React guide
```

### Pull request checklist

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero errors
- [ ] `pnpm format:check` passes
- [ ] `pnpm test:coverage` passes (line coverage ≥ 80 %)
- [ ] `pnpm build` passes
- [ ] `pnpm audit --prod --audit-level moderate` reports nothing
- [ ] New behaviour has co-located tests; a security check has a test that fails without it
- [ ] No `any`, no dead code, no secret or token in a message, log or test output
- [ ] Docs (`docs-site/`), README quick start and `CHANGELOG.md` updated for user-visible changes
- [ ] Breaking changes bump the version and carry a migration note

For the rationale behind each gate and the standards new code must meet, see
[AGENTS.md](AGENTS.md). Security vulnerabilities must **not** be reported in a public
issue: see [SECURITY.md](SECURITY.md).

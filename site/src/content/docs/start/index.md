---
title: Start
description: Create a TypeScript workspace with shared checks, exact pins and commit hooks.
sidebar:
  order: 0
---

## What it is

House Rules is a GitHub template. It gives each project the same checks and hooks. Agents read the repo's `AGENTS.md` as law; people can use [the rules page](../rules/index.md) to find each check and its docs.

## Make the repo

Use the Node version in `.nvmrc` and pnpm through Corepack. The template pins the pnpm version in `package.json`. With the GitHub CLI signed in, run:

```sh
gh repo create my-app --private --clone --template JakubSzwajka/house-rules
cd my-app
corepack enable
pnpm install --frozen-lockfile
docker compose up -d
pnpm check
pnpm test
```

Use `--public` instead of `--private` for a public repo. Install sets up the pre-commit hook. Postgres is needed for database tests; each suite creates and drops its own database.

## Read the example

The [booking guide](../../../../../examples/booking/README.md) gives a reading order. The app joins booking and payment operations into features. It includes a system refund edge, Party and Identity operations, and a read model over published views. Its Vite/React dashboard uses the web API at `/api`; read-only MCP is at `/mcp`. Every new login gets the member role. The payment provider is a fake. Its [MAP.md](../../../../../examples/booking/apps/api/MAP.md) shows actual ways, feature closures and operation owners. Run `pnpm --filter @example/api map --write` to regenerate it; the freshness test compares without writing.

Production requires ACCOUNTS_SIGNING_KEY, a private P-256 JWK. Set APP_ORIGIN to the public HTTPS origin for Secure cookies. Optional MCP_AUTH_ISSUER adds the real OIDC MCP provider; unset MCP stays closed. The devLocal test issuer is mounted only in development/test.

A feature is one app action and its own entry. Application's `defineFeature` puts its contract and handler in `features/<name>/index.ts`. The handler only calls declared edges. `features/index.ts` exports only Features. Composition declares built-in roles and system permissions. One `Party.may()` plug resolves roles for HTTP and MCP; MCP exposes read features only.

Domain's `defineOperation` describes module or read-model work. Modules publish `<Module>Operations` through `./contract`. Application's `bindOperation` captures their services in composition. A way exposes features over HTTP or MCP, or runs system features through hooks and UTC schedules. Ways never expose module operations. One record, one approval decision and one unit surround the graph when needed. Only the feature runtime opens a production unit.

All domain modules are packages, including app-owned ones under `examples/booking/packages/`. Each owns its tables, migrations and object rules. Stored modules ship memory and Postgres adapters. Read models stay in the app and select published views, filtering by person in SQL.

App source has `features/`, `read-models/`, `ways-in/`, `composition/` and `main.ts`. Ways import package contracts, not domain values. The composition root builds plugs and receives the ways from main. See the [domain guide](../../../../../packages/domain/README.md) and [application guide](../../../../../packages/application/README.md) for the APIs.

In a new project, remove `examples/` and its roots from the workspace and configs. Keep your own apps in `apps/` and domain modules in `packages/`. Write your own `VISION.md`.

## What happens on commit

The agent hook checks commands before they run. Pi uses [the git interceptor](../../../../../.pi/extensions/git-interceptor.ts). It blocks `--no-verify`, `git commit -n`, `core.hooksPath` and `LEFTHOOK=0`. [The shared settings](../../../../../.agents/settings.json) hold the same hook in Claude format, but Claude must load it from `.claude/settings.json`.

Then [lefthook](../../../../../lefthook.yml) runs `pnpm check`, followed by `pnpm test`. A failure blocks the commit. Warnings fail Biome and ESLint too. Fix the finding; never skip the hook or turn off the rule.

CI runs frozen install, check, test, the packed-consumer proof, the booking API build and the site build. The packed proof loads the built files npm users get, not workspace source. Local acceptance clones committed HEAD, so it does not test uncommitted edits.

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

The [booking guide](../../../../../examples/booking/README.md) gives a reading order. The app joins booking and payment nodes into entries. It includes a system refund edge, Party and Identity nodes, and a read model over published views. It has no web page or real payment provider.

Domain's `defineNode` describes a step. Application's `bindNode` runs it, and `defineEntry` chooses an app node as a graph start. A way exposes entries over HTTP or MCP. One record, one approval decision and one unit surround the graph when needed. Only the entry runtime opens a production unit.

All domain modules are packages, including app-owned ones under `examples/booking/packages/`. Each owns its tables, migrations and object rules. Stored modules ship memory and Postgres adapters. Read models stay in the app and select published views, filtering by person in SQL.

App source has `features/`, `read-models/`, `ways-in/`, `composition/` and `main.ts`. Ways import package contracts, not domain values. The composition root builds plugs and receives the ways from main. See the [domain guide](../../../../../packages/domain/README.md) and [application guide](../../../../../packages/application/README.md) for the APIs.

In a new project, remove `examples/` and its roots from the workspace and configs. Keep your own apps in `apps/` and domain modules in `packages/`. Write your own `VISION.md`.

## What happens on commit

The agent hook checks commands before they run. Pi uses [the git interceptor](../../../../../.pi/extensions/git-interceptor.ts). It blocks `--no-verify`, `git commit -n`, `core.hooksPath` and `LEFTHOOK=0`. [The shared settings](../../../../../.agents/settings.json) hold the same hook in Claude format, but Claude must load it from `.claude/settings.json`.

Then [lefthook](../../../../../lefthook.yml) runs `pnpm check`, followed by `pnpm test`. A failure blocks the commit. Warnings fail Biome and ESLint too. Fix the finding; never skip the hook or turn off the rule.

CI runs frozen install, check, test, the packed-consumer proof, the booking API build and the site build. The packed proof loads the built files npm users get, not workspace source. Local acceptance clones committed HEAD, so it does not test uncommitted edits.

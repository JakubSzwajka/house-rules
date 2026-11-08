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
pnpm check
pnpm test
```

Use `--public` instead of `--private` for a public repo. Install sets up the pre-commit hook. No test needs a database: models run in memory.

## Read the example

Apps are built on [Alchemy Domain](https://alchemy.run/domain): aggregates decide commands and record events, views fold events into reads, policies react to events. The template's one framework package, `@house-rules/stack`, adds sign-in, permissions and reusable modules. Its [design notes](../../../../../packages/stack/DESIGN.md) map every older house-rules idea to its Alchemy replacement, and its [agent guide](../../../../../packages/stack/AGENTS.md) shows how an app mounts a module and wires sign-in.

Every command a client sends lists the `Session` middleware and starts its `decide` with `requirePermission`. `Roles` turns a person's roles into permissions once per request. Who owns or may touch one thing lives in that aggregate's state. Policies act as named system actors with explicit grants, never with the roles of the person who caused the event.

The booking example in `examples/booking` has a domain package with the model and a server that hosts it: in memory on Node for local play, on Cloudflare Durable Objects in production.

In a new project, remove `examples/` and its roots from the workspace and configs. Keep your own apps in `apps/` and packages in `packages/`. Write your own `VISION.md`.

## What happens on commit

The agent hook checks commands before they run. Pi uses [the git interceptor](../../../../../.pi/extensions/git-interceptor.ts). It blocks `--no-verify`, `git commit -n`, `core.hooksPath` and `LEFTHOOK=0`. [The shared settings](../../../../../.agents/settings.json) hold the same hook in Claude format, but Claude must load it from `.claude/settings.json`.

Then [lefthook](../../../../../lefthook.yml) runs `pnpm check`, followed by `pnpm test`. A failure blocks the commit. Warnings fail Biome and ESLint too. Fix the finding; never skip the hook or turn off the rule.

CI runs frozen install, check, test, the packed-consumer proof and the site build. The packed proof loads the built files npm users get, not workspace source. Local acceptance clones committed HEAD, so it does not test uncommitted edits.

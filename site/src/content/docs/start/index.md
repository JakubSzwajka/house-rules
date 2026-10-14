---
title: Start
description: What House Rules is, how to make a repo from the template, and what happens when you commit.
sidebar:
  order: 0
---

## What it is

House Rules is a GitHub template for TypeScript monorepos. Every repo made from it gets the same checks, the same pins and the same hooks, and nobody sets them up by hand. Agents take the shortest path, so every rule a tool can check lives in `pnpm check`, and a git hook runs it before each commit.

## Make the repo

You need:

- the GitHub CLI, signed in;
- Node 24.21 or later;
- pnpm through Corepack. Run `corepack enable` once per machine.

Make a private repo from the template and clone it. For a public one, pass `--public` instead of `--private`.

```sh
gh repo create my-app --private --clone --template JakubSzwajka/house-rules
```

Then install and run the checks:

```sh
cd my-app
pnpm install
pnpm check
```

`pnpm install` also sets up the pre-commit hook. In the new repo, `AGENTS.md` is the law. Your agents read it there.

## The example module

The template keeps one module per package. [Bookings](../../../../../examples/booking-platform/packages/bookings/src/facade.ts) declares its root service with `defineModule` from the domain kit, `@house-rules/domain`, captures a storage port when its Layer builds, and has memory and Postgres adapters. Effect owns lazy build and scoped cleanup; two builds construct twice, with no global cache.

The [example guide](../../../../../examples/booking-platform/README.md) maps each framework concept to the file that shows it. The example lives in `examples/booking-platform`, laid out like a regular project; a new project deletes `examples/` and keeps its own code in `apps/` and `packages/`.

`Actor` is an id, and `yield* CurrentActor`, from the application kit, `@house-rules/application`, returns the Actor for one request. Delivery provides `CurrentActor`; module methods take the Actor explicitly. `Bookings.create(actor, input)` sets the owner, and `relation(actor, id)` returns `"owner"` or `"none"`. Legacy rows remain unowned. The example API still lets visitors read bookings, without sending the owner id. See the [domain kit guide](../../../../../packages/domain/README.md) for options, plain-data presets and adapter statics, and the [application kit guide](../../../../../packages/application/README.md) for contracts, gates and delivery.

## What happens on commit

Two hooks stand between a change and a commit.

1. The agent hook runs first. In Pi, [`.pi/extensions/git-interceptor.ts`](../../../../../.pi/extensions/git-interceptor.ts) checks each command before it runs. A command with `--no-verify`, `git commit -n`, `core.hooksPath` or `LEFTHOOK=0` gets this answer:

   ```text
   Blocked hook bypass. Do not use --no-verify, git commit -n, core.hooksPath, or LEFTHOOK=0. Fix the hook failure, or ask before changing the hook policy.
   ```

   [`.agents/settings.json`](../../../../../.agents/settings.json) holds the same hook in Claude Code format.

2. The pre-commit hook runs next. [lefthook](../../../../../lefthook.yml) runs `pnpm check`, then `pnpm test`. If either one fails, the commit fails.

When a check fails, it names a rule. [The rules page](../rules/index.md) lists every rule with a link to its docs. Fix the code. Do not switch the rule off or skip the hook.

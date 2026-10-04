---
title: Use it in your project
description: Start a repo from the template, or install the house plugin and the capability library into an app you already have.
sidebar:
  order: 3
---

There are two ways in. Start a new repo from the template, or bring the plugin into an existing pnpm workspace.

## Start from the template

You need the GitHub CLI, signed in, and Node 24.21 or later. The first command makes a private repo in your account and clones it. Pass `--public` instead of `--private` for a public one.

```sh
gh repo create <name> --private --clone --template JakubSzwajka/house-rules
cd <name>
corepack enable
pnpm install --frozen-lockfile
pnpm check && pnpm test
```

Then make it yours:

1. [ ] Rename `@hosti/` everywhere: package names, imports, `Context.Service` keys, and the `scope` passed to `layout()` in `.dependency-cruiser.cjs`.
2. [ ] Rewrite `AGENTS.md` for your project, and write your own `VISION.md`.
3. [ ] Replace `apps/api` and `packages/bookings` with your own code. Keep their shape.
4. [ ] Run `pnpm check` and `pnpm test` again.

The README's [adapt it](../../../../../README.md#adapt-it) list names every file to copy when you start from an existing repo instead.

## Install the house plugin in another app

The plugin is not on npm. Install it from GitHub, pinned to a full 40-character commit, with a pnpm subpath:

```json
{
  "devDependencies": {
    "@house-rules/rules": "github:JakubSzwajka/house-rules#<full-40-char-sha>&path:/packages/rules"
  }
}
```

You need Node 24.21 or later, pnpm, and a `pnpm-workspace.yaml` with a `packages:` list. Each entry point has optional peers that you install yourself. The README of the plugin lists them: [`packages/rules/README.md`](../../../../../packages/rules/README.md#install). Then wire the thin configs as [the stack](../guides/the-stack.md#thin-configs) shows.

## Install the capability library

`@house-rules/capability` installs the same way, with `&path:/packages/capability`. It needs `effect` pinned to the exact version it names as a peer. Its README walks through the tsconfig flags, Next.js, and tests: [`packages/capability/README.md`](../../../../../packages/capability/README.md#install-in-another-app).

## Upgrade

Change the SHA, run `pnpm install`, and run your checks. Read the rule docs that changed between the two commits first. A new rule can fail code that passed yesterday, and that is the point.

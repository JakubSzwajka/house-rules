---
title: house-rules
description: A TypeScript monorepo template and the house plugin behind it. Checked rules for code that agents write.
template: splash
hero:
  title: house-rules
  tagline: A TypeScript monorepo template and the house plugin behind it. Agents take the shortest path, so house-rules puts the rules on that path, as checks that fail the commit.
  actions:
    - text: Start here
      link: /start/what-is-house-rules/
      icon: right-arrow
    - text: All rules
      link: /rules/
      variant: minimal
    - text: llms.txt
      link: /llms.txt
      variant: minimal
---

## What you get

1. **A template, the stack.** A pnpm workspace with Turborepo, TypeScript 7 and Effect 4, an example app and module, and the checks already wired. Start a repo from it with `gh repo create <name> --template JakubSzwajka/house-rules`. Read [the stack](guides/the-stack.md).
2. **The house plugin, `@house-rules/rules`.** ESLint rules, a Dependency Cruiser layout, TypeScript and Biome presets, and two bins. Other apps install it from GitHub at a pinned commit. Read [all rules](rules/index.md).
3. **Capabilities, `@house-rules/capability`.** One contract and one handler per action, with permission and approval gates, and MCP tools built from the contract. Read [capabilities](guides/capabilities.md).
4. **The fence.** `pnpm check` and `pnpm test` run before every commit, and agent harnesses block `--no-verify`. Read [the fence](guides/the-fence.md).

## A few parts

A few of the rules, what each one refuses, and the tool that checks it. [All rules](rules/index.md) has the full list.

| Rule | Refuses | Checked by |
| --- | --- | --- |
| [Exact pins](rules/node/exact-pins.md) | A dependency that is not an exact version, `workspace:<exact>`, or a Git spec with a full commit SHA | Node |
| [use-case-is-capability](rules/eslint/use-case-is-capability.md) | A use-case file that does not export exactly one `implement(...)` capability | ESLint |
| [no-hand-rolled-surface](rules/eslint/no-hand-rolled-surface.md) | `Tool.make`, `Rpc.make`, or `HttpApiEndpoint.<method>` outside `packages/capability/**` | ESLint |
| [no-cycles](rules/dependency-cruiser/no-cycles.md) | Circular imports | Dependency Cruiser |
| [noNonNullAssertion](rules/biome/no-non-null-assertion.md) | `!` non-null assertions | Biome |
| [house-rules-migrations](rules/node/house-rules-migrations.md) | Cross-module foreign keys, SQL that touches another package's tables, use-cases that open a transaction | Node |

## If you are an agent

Read [for agents](start/for-agents.md) first. Every page has a raw Markdown copy: add `.md` to its path, such as `/rules/eslint/comment-discipline.md`. `/llms.txt` lists every page, and `/llms-full.txt` holds all of them in one file.

The law for code in this repo is [`AGENTS.md`](../../../../AGENTS.md), not this site. The site explains it and links to it.

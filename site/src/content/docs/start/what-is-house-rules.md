---
title: What house-rules is
description: A template for TypeScript monorepos, the plugin that checks it, and the fence that makes agents run the checks.
sidebar:
  order: 1
---

house-rules is how a new TypeScript project starts. Every repo made from it gets the same checks, the same pins and the same hooks. Nobody sets them up by hand, and no two repos drift apart.

## Why it exists

Agents take the shortest path. If a rule lives only in prose, an agent skips it the first time the rule is in its way. So every rule a tool can check lives in `pnpm check`. A git hook runs that check before each commit, and the agent harnesses block `--no-verify`.

The fence does not make an agent good. It raises the floor: the worst normal run still passes the checks. Prose covers the rest, and a reviewer reads it. [`VISION.md`](../../../../../VISION.md) says this in four short paragraphs.

## The three parts

```text
house-rules (one GitHub repo)
├── the stack            the template: a pnpm workspace with checks wired in
│   ├── apps/api         example app: delivery, server, use-cases
│   └── packages/bookings  example module
├── packages/rules       @house-rules/rules, the house plugin
└── packages/capability  @house-rules/capability, one action = one contract
```

1. **The stack** is a GitHub template. It shows the plugin wired into a real workspace, with example code in Effect 4. See [the stack](../guides/the-stack.md).
2. **The house plugin** holds every checked rule and preset: ESLint rules, a Dependency Cruiser layout, TypeScript and Biome presets, and two bins. Apps outside this repo install it from GitHub at a pinned commit. See [all rules](../rules/index.md).
3. **The capability library** turns each use-case into one contract and one handler, with permission and approval gates. MCP tools are built from the contract. See [capabilities](../guides/capabilities.md).

## Law, words, and this site

| File | What it is |
| --- | --- |
| [`AGENTS.md`](../../../../../AGENTS.md) | The law. Agents and people follow it in this repo and in every repo made from it. |
| [`CONTEXT.md`](../../../../../CONTEXT.md) | The words this repo uses. The [glossary](../reference/glossary.md) is a short version. |
| [`README.md`](../../../../../README.md) | The layout, the commands, and the prose rules no tool checks. |
| This site | Explains the above, one topic per page, and links to the source. |

When this site and `AGENTS.md` disagree, `AGENTS.md` wins. Then fix the page.

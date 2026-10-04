---
title: The stack
description: The template's workspace, its apps and packages, the layers inside an app, and the thin configs over the house plugin.
sidebar:
  order: 1
---

The stack is a pnpm workspace run by Turborepo. TypeScript is pinned to 7, and the example code uses Effect 4. One lockfile covers everything.

## Layout

```text
.
├── apps/api/             @hosti/api: delivery, server, use-cases
├── packages/bookings/    @hosti/bookings: one module, src/index.ts is its only export
├── packages/capability/  @house-rules/capability: contracts, gates, toTool
├── packages/rules/       @house-rules/rules: the house plugin
├── site/                 @house-rules/site: this docs site
├── skills/               agent skills, one folder each
└── tests/                wiring tests for the thin configs and the fence
```

An **app** lives in `apps/<name>`, and nothing imports it. A **package** lives in `packages/<name>` and holds one module. Apps and packages import a package by its name, such as `@hosti/bookings`, and declare it as `workspace:<exact version>`. They never reach into it by relative path. Dependency Cruiser checks all of this: see [the layout rules](../rules/dependency-cruiser/index.md).

## Layers inside an app

```text
apps/api/src/
├── delivery/    adapters: HTTP routes, MCP tools, web views
├── server/      wiring and runtime
├── use-cases/   one capability per file
└── main.ts      only main.ts and index.ts sit directly in src/
```

Delivery and server never import each other. A use-case imports packages, never delivery, server, or another use-case. Every use-case is a [capability](capabilities.md).

## Thin configs

Each tool config at the root points at a preset from the house plugin, and adds only project values. A rule changes in `packages/rules`, never by copying a preset into a thin config.

| File | Extends | Adds |
| --- | --- | --- |
| [`eslint.config.mjs`](../../../../../eslint.config.mjs) | `configs.recommended`, `configs.capability`, the Markdown preset | ignores; `comment-discipline` off inside the plugin itself |
| [`.dependency-cruiser.cjs`](../../../../../.dependency-cruiser.cjs) | `layout({ scope: "@hosti/" })` | skips `packages/rules` |
| [`tsconfig.base.json`](../../../../../tsconfig.base.json) | `tsconfig/effect.json` | nothing |
| [`biome.json`](../../../../../biome.json) | `@house-rules/rules/biome` | its own `files.includes`, because Biome does not merge it |

The tests in [`tests/thin-configs.test.mjs`](../../../../../tests/thin-configs.test.mjs) prove each config still extends its preset.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install, patch `tsc` with the Effect language service, install the git hook. |
| `pnpm check` | Every [checked rule](checks.md). |
| `pnpm test` | Wiring tests, then each workspace package's tests. |
| `pnpm fix` | Biome formatting and safe lint fixes. |
| `pnpm acceptance` | Clone HEAD into a temp folder and run install, check, and test there. |

The [commands reference](../reference/commands.md) has the full list.

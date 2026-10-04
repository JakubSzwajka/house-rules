---
title: Commands
description: Every root command in the stack, and the commands for this docs site.
sidebar:
  order: 2
---

Use pnpm, at the version `packageManager` pins. Run `corepack enable` once per machine.

## The stack

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install from the lockfile. `prepare` then patches `tsc` with the Effect language service and installs the lefthook hook. |
| `pnpm check` | Pins, migrations, environment, Biome, ESLint, typecheck in each workspace package, Dependency Cruiser. See [what pnpm check runs](../guides/checks.md). |
| `pnpm test` | `node --test` over `tests/`, then `test` in each workspace package. |
| `pnpm env:check` | Resolve and validate every variable in `.env.schema`. |
| `pnpm exec varlock run -- <cmd>` | Run a command with the environment values injected. |
| `pnpm fix` | Biome formatting and safe lint fixes. Rewrites files. |
| `pnpm format` | Biome formatting only. Rewrites files. |
| `pnpm acceptance` | Clone the committed HEAD into a temp folder and run install, check, and test there. |
| `pnpm vendor:agent-sources` | Clone the Effect source at the pinned version into `.agent_sources/`. |
| `pnpm --filter <package> add <dep>` | Add a dependency to one workspace package, as an exact pin. |

Before you call a change ready, `pnpm check` and `pnpm test` both exit 0.

## The docs site

| Command | What it does |
| --- | --- |
| `pnpm --filter @house-rules/site generate` | Rewrite the generated rule and skill pages from `packages/rules` and `skills/`. |
| `pnpm --filter @house-rules/site dev` | Generate, then serve the site with live reload. |
| `pnpm --filter @house-rules/site build` | Generate, build the static site into `site/dist/`, then write `llms.txt`, `llms-full.txt`, and a `.md` copy of every page. |
| `docker build -f site/Dockerfile .` | Build the site and serve it with Caddy on port 80. `/healthz` answers 200. |

`pnpm test` fails when a generated page is stale. Run `generate` and commit the result. The [write-a-docs-page](../skills/write-a-docs-page.md) skill has the details.

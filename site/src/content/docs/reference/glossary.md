---
title: Glossary
description: The words house-rules uses, in one line each. CONTEXT.md holds the full definitions.
sidebar:
  order: 1
---

Short forms of the terms in [`CONTEXT.md`](../../../../../CONTEXT.md). When a line here and `CONTEXT.md` disagree, `CONTEXT.md` wins.

## The repo

| Term | Meaning |
| --- | --- |
| house plugin | `@house-rules/rules` in `packages/rules`. Owns every checked rule and preset. |
| house rules | The rules the plugin checks. |
| preset | A config the plugin hands down: the TypeScript, Biome, and ESLint configs, and `layout()`. |
| the stack | The template: a pnpm workspace with the plugin wired in. |
| thin config | A root config that extends a preset and adds only project values. |
| project value | A setting only one project knows, such as the `@hosti/` scope. |
| prose rules | Rules no tool checks. The README lists them, and a reviewer reads for them. |
| wiring tests | Tests in `tests/` that prove the thin configs and the fence are hooked up. |
| fence | Exact pins, `pnpm check`, `pnpm test`, the git hook, and the harness hooks that block `--no-verify`. |
| law | `AGENTS.md`. |
| vision | `VISION.md`. Each project made from the template writes its own. |
| agent sources | Shallow clones of dependency source in `.agent_sources/`, for agents to read. |

## Workspace and modules

| Term | Meaning |
| --- | --- |
| workspace package | Any folder under `apps/` or `packages/` with its own `package.json`. |
| app | A workspace package under `apps/`. Holds delivery, server, and use-case code. Nothing imports it. |
| package | A workspace package under `packages/`. Holds one module. |
| module | Behavior with one interface and a private implementation. |
| seam | Where a module's interface sits. For a package, its public entry. |
| public entry | `src/index.ts`, the only path a package's `exports` names. |
| depth | Useful behavior per amount of interface a caller must learn. |
| service | A module's interface: a `Context.Service` class whose methods return Effects. |
| expected error | A `Schema.TaggedError` class in the Effect error channel. |
| layer | An Effect `Layer` that provides a service. Not a delivery, server, or use-case folder. |
| migrations | A module's `.sql` files in `packages/<name>/migrations/`. |
| owning package | The package whose migration creates a table. |

## Ports and adapters

| Term | Meaning |
| --- | --- |
| port, slot | A service tag that says what a caller needs. |
| layer adapter | A `Layer` that fills a slot, such as `Bookings.fromRecords`. |
| delivery adapter | Delivery code that lets one kind of caller reach the use-cases. |
| cartridge | One job plus its infrastructure, pushed in with one `Layer.provide` line. |
| pull-out test | Delete a cartridge's package and its line; does the rest still build and pass? |

## Capabilities and access

| Term | Meaning |
| --- | --- |
| capability | One named action an app offers: a contract plus one handler. |
| contract | Name, description, input, output and failure schemas, flags, permission, approval. |
| surface | What an outside caller reaches: an MCP tool, an RPC, an HTTP endpoint. Built from a contract. |
| Actor | The user a call acts for. |
| Viewer | The Effect service that holds the Actor for one request. |
| permission | A `resource:action` string, such as `bookings:read`, or `"public"`. |
| Grant | The slot that answers whether the caller holds a permission at all. Fails with `Forbidden`. |
| app role | A fact about the caller with no object, such as admin. Feeds the Grant. |
| Approval | The slot that asks a human whether they mean this call. Fails with `ApprovalDenied`. |
| relation | How the caller stands to one object, such as owner or shared. |
| policy | Maps each relation to the permissions it carries. |
| tool | One MCP action: name, description, input schema, annotations, handler. |
| tool catalogue | The list of tools in one app's delivery layer. |
| resource server | Checks OAuth tokens another server issued. A remote MCP server is one. |

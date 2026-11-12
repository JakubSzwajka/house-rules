---
name: house-rules
description: Build an app on house-rules and Alchemy Domain. Load it to add an aggregate, command, view, policy, saga or Api, copy a module from examples/modules, wire sign-in and permissions, or fix a check. It routes each job to the guide that owns it.
---

# House rules

Read the root `AGENTS.md` first. It is the law and wins over this skill. Then read `CONTEXT.md` and use its words. This skill points to guides; it does not copy their API.

## Find the guide

| Job | Read |
| --- | --- |
| Map an old house-rules idea to the new model, or follow the block rules | [packages/stack/DESIGN.md](../../packages/stack/DESIGN.md) |
| Copy a module from `examples/modules`, wire `Session`, `SessionLive`, `Roles` and an `AuthProvider`, guard a command with `requirePermission`, act as a system actor | [packages/stack/AGENTS.md](../../packages/stack/AGENTS.md), then the [stack README](../../packages/stack/README.md) |
| Model requirements as blocks, lay out the domain and server packages, write stories, host on Cloudflare, drive a frontend | Alchemy's installed skill: `packages/stack/node_modules/@alchemy.run/domain/skills/alchemy-domain/SKILL.md` and its `references/*.md` |
| Use an Effect API | The installed `effect/AGENTS.md` and `ai-docs`, then `.agent_sources/` after `pnpm vendor:agent-sources` |
| Fix a check | The [rules README](../../packages/rules/README.md) table, then the row's Docs link. Fix the code, not the rule. |

In an app outside this repo, the stack guides live at `node_modules/@house-rules/stack/AGENTS.md` and `DESIGN.md`, and Alchemy's skill under `node_modules/@alchemy.run/domain/skills/alchemy-domain/`.

## Before you report done

From the repo root, with the pinned Node and pnpm: `pnpm check` and `pnpm test` exit 0. Never bypass the commit hook.

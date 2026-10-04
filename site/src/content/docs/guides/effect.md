---
title: Effect
description: How Effect 4 code is written in the stack, and which of those rules the compiler checks.
sidebar:
  order: 7
---

The example code uses [Effect 4](https://effect.website), which is still a release candidate. Its API moves, so trust the installed version over memory.

## Before you edit Effect code

1. [ ] Read `effect/AGENTS.md` and `effect/ai-docs/` inside a workspace package's `node_modules`, such as `packages/bookings/node_modules/effect/AGENTS.md`. pnpm does not install `effect` at the repo root.
2. [ ] For API shape, read the source mirror at `.agent_sources/github.com/Effect-TS/effect`. Run `pnpm vendor:agent-sources` if it is missing.

## The rules

| Rule | Checked by |
| --- | --- |
| Expected errors are `Schema.TaggedError` classes in the error channel. Never a global `Error`, never `throw` in Effect code. | [Effect diagnostics](../rules/typescript/effect-diagnostics.md), in part |
| A service method returns an Effect with no requirements. | [Effect diagnostics](../rules/typescript/effect-diagnostics.md) (`leakingRequirements`) |
| Delivery maps typed errors once, in the handler. Use-cases let them flow. | review |
| Never run an Effect by hand inside Effect code or tests. Tests use `it.effect` or `it.layer`. | [Effect diagnostics](../rules/typescript/effect-diagnostics.md) (`runEffectInsideEffect`), and review |
| `effect`, `@effect/vitest`, and every `@effect/*` runtime package share one exact version. | review, with [exact pins](../rules/node/exact-pins.md) |
| Never set an Effect diagnostic below `error`, and never override the preset's `plugins` block. | review; the wiring test checks `tsconfig.base.json` |

The diagnostics run only in a `tsc` patched by `@effect/tsgo`. The root `prepare` script patches it on install. If `tsc` stops reporting Effect errors, run `pnpm exec effect-tsgo patch`.

## Release candidates

A new Effect RC is often less than a day old, so it fails the [release-age check](pins-and-install-policy.md). It needs a `minimumReleaseAgeExclude` entry for that exact version, and the owner approves it. A bump moves `effect` and `@effect/vitest` together and replaces the old entry.

## Code without Effect

This site's generator is plain Node code, not Effect. Its `tsconfig.json` extends the plugin's `strict.json` preset instead of the Effect preset, because Effect diagnostics such as `nodeBuiltinImport` and `globalConsole` would fail every line of a Node script. Every strict flag still applies.

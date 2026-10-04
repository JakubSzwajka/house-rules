---
title: What pnpm check runs
description: The order of the checks, the tool behind each one, and the prose rules that no tool can check.
sidebar:
  order: 2
---

`pnpm check` runs seven steps and stops at the first failure. `pnpm test` runs after it, in the git hook and in CI.

```text
pnpm check ─> pins ─> migrations ─> env:check ─> biome ─> lint ─> typecheck ─> deps
pnpm test  ─> node --test tests/ ─> turbo run test (each workspace package)
```

| Step | Tool | Catches | Rules |
| --- | --- | --- | --- |
| `pins` | `house-rules-pins` bin | a dependency that is not an exact version | [Exact pins](../rules/node/exact-pins.md) |
| `migrations` | `house-rules-migrations` bin | SQL that reaches another module's tables, a use-case that opens a transaction | [house-rules-migrations](../rules/node/house-rules-migrations.md) |
| `env:check` | varlock | an environment variable that fails `.env.schema` | none in the plugin |
| `biome` | Biome | formatting, `export *`, `!` assertions, file names | [Biome rules](../rules/biome/index.md) |
| `lint` | ESLint | narrative comments, broken Markdown links, use-cases that are not capabilities, surfaces built by hand | [ESLint rules](../rules/eslint/index.md) |
| `typecheck` | TypeScript 7 with Effect diagnostics | type errors, floating Effects, global errors in the error channel | [TypeScript rules](../rules/typescript/index.md) |
| `deps` | Dependency Cruiser | import cycles, layer breaks, deep imports, `utils` folders | [Dependency Cruiser rules](../rules/dependency-cruiser/index.md) |

Turborepo runs `typecheck` and `test` in each workspace package, in dependency order, with caching off. A gate always runs.

## What no tool checks

A green `pnpm check` says nothing about these. A reviewer reads for them. The full list is in the README's [prose rules](../../../../../README.md#prose-rules).

1. [ ] A comment gives a real reason. It does not restate the code.
2. [ ] Errors are designed, not just typed. Delivery maps them in one place.
3. [ ] A cast states its intent.
4. [ ] Nobody loosens a compiler option or a preset rule in a thin config.
5. [ ] A cartridge passes the pull-out test: delete its package and its one `Layer.provide` line, and the rest still builds.
6. [ ] One module write method is one transaction. A use-case never opens one.

## When a check fails

The error names the rule. Open its page under [all rules](../rules/index.md), fix the code, and run the check again. Never make a check pass by switching the rule off. `AGENTS.md` lists the config changes that need the owner's yes.

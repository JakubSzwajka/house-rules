---
title: Pins and install policy
description: Exact versions everywhere, a one-day release age, and no install scripts.
sidebar:
  order: 4
---

Every dependency is an exact version. pnpm refuses a version younger than a day, and no dependency runs an install script. Together they make a supply-chain attack slower and an upgrade a deliberate act.

## Exact pins

The [`house-rules-pins`](../rules/node/exact-pins.md) bin checks every `package.json` in the workspace. It accepts:

| Spec | Example |
| --- | --- |
| an exact version | `7.0.2`, `4.0.0-rc.117` |
| `workspace:` plus an exact version | `workspace:0.6.0` |
| a Git spec at a full 40-character commit | `github:owner/repo#<sha>` |
| the same with a pnpm subpath | `github:owner/repo#<sha>&path:/packages/rules` |

It fails on `^`, `~`, ranges, tags, branch names, and `workspace:*`. `packageManager` names an exact pnpm version, and Node is pinned in `.nvmrc`.

## The install policy

[`pnpm-workspace.yaml`](../../../../../pnpm-workspace.yaml) holds it:

| Setting | Effect |
| --- | --- |
| `saveExact: true`, `saveWorkspaceProtocol: true` | `pnpm add` writes an exact pin, and `workspace:<exact>` for a workspace package. |
| `engineStrict: true` | The `engines` field is enforced. |
| `minimumReleaseAge: 1440` | A version younger than one day fails the install. |
| `minimumReleaseAgeExclude` | Named exceptions, one per exact version. Effect release candidates are the usual case. |
| `allowBuilds` | Every dependency with an install script, each set to `false`. |
| `packageExtensions` | Gives the ESLint plugin its own TypeScript 6.0.3. |

A new dependency with an install script fails the install until it gets an `allowBuilds` entry. The entry is `false`: the package must work without its script. esbuild, for example, ships its binary as an optional dependency, so its script only verifies it.

## Ask first

`AGENTS.md` lists what needs the owner's yes. For dependencies that is: adding, removing or bumping one; a `minimumReleaseAgeExclude` entry; and an `allowBuilds` entry set to `true`. Never use `shamefully-hoist`, `nodeLinker: hoisted`, or `--force`.

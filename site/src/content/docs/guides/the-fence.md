---
title: The fence
description: The git hook, the harness hooks, and the command policy that stop an agent from skipping the checks.
sidebar:
  order: 3
---

The fence is the safety guard. It is everything that stops an agent from skipping the checks: exact pins, `pnpm check`, `pnpm test`, the lefthook pre-commit hook, and the harness hooks that block `git ... --no-verify`.

```text
git commit ──> lefthook pre-commit ──> pnpm check ──> pnpm test

agent bash call
  Claude Code  .agents/settings.json PreToolUse ─> scripts/hooks/block-git-no-verify.mjs ─┐
  Pi           .pi/extensions/git-interceptor.ts ───────────────────────────────────────┤
                                                                                        v
                                                          scripts/vcs-command-policy.mjs
                                                            bypass    ─> deny, with reason
                                                            git or jj ─> allow
```

## What the policy blocks

[`scripts/vcs-command-policy.mjs`](../../../../../scripts/vcs-command-policy.mjs) denies:

1. [ ] a `git` command that contains `--no-verify` or `core.hooksPath`;
2. [ ] a `git commit` with `-n`;
3. [ ] any command that sets `LEFTHOOK=0`.

It matches `--no-verify` anywhere, even inside a commit message, so reword the message. The tests in [`tests/`](../../../../../tests) hold the full case list.

## Where each piece lives

| Piece | File |
| --- | --- |
| Git hook | [`lefthook.yml`](../../../../../lefthook.yml), installed by `pnpm install` |
| Pi hook | [`.pi/extensions/git-interceptor.ts`](../../../../../.pi/extensions/git-interceptor.ts) |
| Claude Code hook | [`.agents/settings.json`](../../../../../.agents/settings.json). Claude Code reads hooks only from `.claude/settings.json`, so copy or link it there. |
| CI | [`.github/workflows/ci.yml`](../../../../../.github/workflows/ci.yml): install, check, test, nothing else |

In Pi, the extension also sets no-op editors on every allowed `git` or `jj` call, so a rebase never waits on an editor nobody sees.

## What it does not do

The fence raises the floor. It does not make an agent careful. An agent can still write the blocked command into a script and run that. A reviewer still reads every change.

`pnpm acceptance` clones the committed HEAD into a temp folder and runs install, check, and test there. It proves a cold clone works. It does not see uncommitted changes.

The fence is adapted from [rat-stack](https://github.com/joelhooks/rat-stack) by Joel Hooks, under MIT. See [`NOTICE`](../../../../../NOTICE).

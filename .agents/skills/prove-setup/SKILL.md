---
name: prove-setup
description: Prove the rules package CLI behavior in disposable local fixtures.
---

# Rules CLI proof setup

Use this setup for `@house-rules/rules` CLI changes. It does not cover the example server or domain packages.

## Start

1. Work in the selected task worktree, never the primary checkout.
2. Select Node from `.nvmrc` and pnpm from `package.json`.
3. Run `pnpm install --frozen-lockfile` if dependencies are absent.
4. Create a disposable fixture directory with `mktemp -d`. Record its path.
5. Run package bins by their absolute paths with the fixture as the working directory.

No server, port, browser, login or seed is required. Use invented fixture data only. Save commands, stdout, stderr and exit codes in the proof run folder.

## Allowed mutations

Create and edit files only in the proof run folder and the disposable fixture directory. A fixture may initialize its own Git repository to exercise default file selection. Do not modify the task checkout, production, credentials or another repository. Do not publish packages.

For comment checks, exercise a valid one-line why, an adjacent narrative group, syntax-owned directives, quoted markers and hidden workflow discovery. Use the current rule documentation for exact commands and exception syntax. Record unsupported syntax as a gap, not a pass.

## Stop

Remove only the disposable fixture directory created by this run. Keep the proof run folder and all earlier evidence. No process should remain running.

# Task 289 manual acceptance

Run only in the task worktrees with pinned Node 24.21.0 and pnpm 12.5.1. Save transcripts and captures outside git under `~/.pi/agent/proof/<repo>/task-289-<repo>/`. Never print tokens, read live secrets or touch operator servers.

| Step | Action | Expected |
| --- | --- | --- |
| F1 | Use a standalone consumer of only `houseRules.configs.recommended`. Lint a direct defineFeature with `flags: { readOnly: true }`. | Error severity 2 from `house-rules/command-kind`, without opt-in. |
| F2 | Move that descriptor to `read-models/probe/index.ts`, call defineReadModel, omit readOnly, and split the root registry. Lint with the same default. | No command-kind error. Full app preset also accepts the valid query. |
| F3 | Exercise aliases, spreads, computed and unresolved flag definitions against the default. Also lint a literal false command. | Unknown/true rejected; false accepted. Kit/tests/tooling retain existing exceptions. |
| F4 | Walk the booking repo prove skill for migrated queries over HTTP, including unauthenticated/wrong-person refusal, and existing show_booking over MCP. Keep exact existing MCP exposures. Inspect map and plan kinds. | Same public name/path/data/permissions; direct read-model kinds; no wrappers or write edges. If no prove skill exists, record CANNOT PROVE rather than invent startup. |
| T1 | In Trainer, use its actual installed config on the old wrong-kind snippet and a valid direct read model. Confirm resolved package source belongs to task289 immutable batch. | Error from shared rule ID only; local plugin absent; valid query clean. |
| T2 | Follow Trainer's `.agents/skills/prove/SKILL.md` to start an isolated Express fixture on a free loopback port. Use representative owner query, command via UI, and foreign/missing/denied refusals. | Real-host reads and writes work; private data stays private. |
| T3 | Query through MCP, retain approval refusal, inspect desktop and phone after the UI command, then stop only the fixture. | Structured query data, refusal stays closed, screenshot evidence, listener stopped. |
| T4 | Run map diff as parent deterministic verification and inspect counts. | Zero diff; 16 modules, 174 ops, 34 commands, 28 queries, 6 ways. |

## CLI examples

The default-preset harness must import the package, not a private rule file:

```js
import { ESLint } from "eslint";
import houseRules from "@house-rules/rules";
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: houseRules.configs.recommended,
});
const [result] = await eslint.lintText(
  'import { defineFeature } from "@house-rules/application/contract";\n' +
  'export const probe = defineFeature("probe", { flags: { readOnly: true } });',
  { filePath: "apps/probe/src/features/probe/index.ts" },
);
console.log(result.messages.map(({ ruleId, severity, message }) => ({ ruleId, severity, message })));
```

After migration the direct descriptor uses `defineReadModel` under `src/read-models/probe/index.ts`. Commands stay under `src/features/`; projections stay under `src/projections/`.

```bash
# Parent owns the test suite. Prover uses lint/API commands, not a test runner.
pnpm exec eslint apps/api/src/features/kind-probe/index.ts
node apps/api/scripts/prove.mjs api "$RUN" owner show_athlete '{}'
node apps/api/scripts/prove.mjs api "$RUN" none show_athlete '{}'
pnpm --filter @trainer/app run map -- --diff --text
```

A wrong-kind lint exit is expected evidence, not a failed proof command. Never add a lint disable to make it pass. Record each step as matches, deviates or CANNOT PROVE with exact observed output.

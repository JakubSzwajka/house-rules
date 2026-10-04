---
title: For agents
description: How an agent reads this site, which files are the law, and which skill to load for which job.
sidebar:
  order: 2
---

This site is written for agents as much as for people. Every page exists as Markdown, and the pages about rules and skills come straight from the code.

## Read it as Markdown

| URL | What you get |
| --- | --- |
| `/llms.txt` | An index of every page, with a one-line description each. |
| `/llms-full.txt` | Every page in one file. Load it once instead of crawling. |
| `/<path>.md` | One page as Markdown. `/guides/the-fence/` becomes `/guides/the-fence.md`, and `/rules/` becomes `/rules.md`. |

Links inside the Markdown copies point at other Markdown copies, or at the source file on GitHub.

## Where the truth lives

1. [ ] [`AGENTS.md`](../../../../../AGENTS.md) is the law. Read it before you change code in a repo made from the stack.
2. [ ] [`CONTEXT.md`](../../../../../CONTEXT.md) defines the words. Use them as written: a *module* is a package, a *capability* is one action, the *fence* is what blocks skipped checks.
3. [ ] The [rule pages](../rules/index.md) are generated from `packages/rules`. They show the rule's own metadata, so trust them over memory.
4. [ ] The [skill pages](../skills/index.md) are generated from `skills/*/SKILL.md`. Load the file itself when your harness supports skills.

## Pick a skill

| Job | Skill |
| --- | --- |
| Find your way around House Rules for the first time | [learn-house-rules](../skills/learn-house-rules.md) |
| Add a module as a workspace package | [add-an-effect-module](../skills/add-an-effect-module.md) |
| Add one action to an app | [add-a-capability](../skills/add-a-capability.md) |
| Let agents call a use-case over MCP | [add-an-mcp-tool](../skills/add-an-mcp-tool.md) |
| Add or change a page on this site | [write-a-docs-page](../skills/write-a-docs-page.md) |

## When a check fails

Fix the code. Do not loosen a rule, skip a hook, or widen a pin. Open the rule's page: its ID is in the error, and the page says what it catches and why. If the rule itself looks wrong, say so to the owner. The [fence](../guides/the-fence.md) page lists the commands a harness blocks.

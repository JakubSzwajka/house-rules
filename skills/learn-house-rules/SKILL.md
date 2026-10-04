---
name: learn-house-rules
description: Find your way around house-rules or a repo made from its template. Where the law, the words, the rules and the docs site are, and the order to read them in before you change code.
---

# Learn house-rules

Read before you write. house-rules has a law, a vocabulary, checked rules, and a docs site. Each answers a different question. This skill says which to open and when.

## 1. Know the three parts

```text
house-rules
├── the stack            a pnpm workspace template with the checks wired in
├── packages/rules       @house-rules/rules, the house plugin: every checked rule
└── packages/capability  @house-rules/capability: one action = one contract + one handler
```

A repo made from the template has the same shape, with its own scope instead of `@hosti/`.

## 2. Read in this order

1. `AGENTS.md`. The law. It wins over everything else, this skill included.
2. `CONTEXT.md`. The words. Use them as written: a *module* is a package, a *capability* is one action, the *fence* is what blocks skipped checks.
3. `README.md`. The layout, the commands, and the prose rules no tool checks.
4. The docs site, `https://stack.kubaszwajka.com`, for one topic at a time.

For the site, fetch Markdown, not HTML:

| URL | Use it to |
| --- | --- |
| `/llms.txt` | See every page with a one-line description. |
| `/llms-full.txt` | Load every page at once. |
| `/<path>.md` | Read one page, such as `/guides/the-fence.md` or `/rules.md`. |

Offline, read the same pages in `site/src/content/docs/`.

## 3. Find the rule behind an error

A failing check names its rule: `house-rules/comment-discipline`, `no-cycles`, `useFilenamingConvention`, `TS377001 ... effect(floatingEffect)`.

1. Open `/rules.md` on the site, or `packages/rules/README.md` in the repo. Find the rule's row.
2. Open the rule's page, `/rules/<tool>/<rule>.md`. It shows what the rule catches, its metadata, and its docs.
3. Fix the code. Never switch the rule off, skip the hook, or widen a pin.

`pnpm check` and `pnpm test` must both exit 0 before a change is ready.

## 4. Pick the skill for the job

| Job | Skill |
| --- | --- |
| Add a module as a workspace package | `skills/add-an-effect-module/SKILL.md` |
| Add one action to an app | `skills/add-a-capability/SKILL.md` |
| Let agents call a use-case over MCP | `skills/add-an-mcp-tool/SKILL.md` |
| Add or change a docs page | `skills/write-a-docs-page/SKILL.md` |

## 5. Know what needs a yes

`AGENTS.md` has the list under "Safe vs needs approval". The short version: code and tests that keep the checks green are safe. A dependency change, a looser config, a write or destructive MCP tool, a commit, and a push all need the owner first.

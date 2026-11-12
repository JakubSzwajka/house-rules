# Modules to copy

Domain modules that an app copies into its own domain package and then owns. They are examples, not dependencies: no app imports them, and nothing here is published.

| Module | What it holds |
| --- | --- |
| [comments](packages/domain/src/comments/README.md) | flat comments on a target, author edits, moderated deletes |
| [contacts](packages/domain/src/contacts/README.md) | email, phone and postal contacts per owner, verification by one-time code |
| [notes](packages/domain/src/notes/README.md) | immutable notes on a target |
| [notifications](packages/domain/src/notifications/README.md) | a person's inbox, preferences, quiet hours and delivery ledger over `Delivery` |
| [organisations](packages/domain/src/organisations/README.md) | organisations, members and their roles |
| [projects](packages/domain/src/projects/README.md) | projects with configurable statuses and unique slugs |
| [relations](packages/domain/src/relations/README.md) | typed, directed edges between opaque nodes |
| [work-items](packages/domain/src/work-items/README.md) | work items with a workflow, a holder and one level of children |

## Why copy

A module's events are the app's stored data for as long as the app runs. When an app owns the module's code, it owns that data format. It adds a field, a rejection or a rule inside the module's own aggregate, so the change commits in one transaction. A shared package would make every event change a data change in every app.

The parts that must stay the same in every app stay in `@house-rules/stack`: the actor, permissions, `Roles`, `Session` and its providers, `Target` and the `Delivery` ports. The modules import those from the package.

## How to copy one

1. Copy `packages/domain/src/<module>/` into your domain package, for example `packages/domain/src/<module>/`. Its `tests/` folder comes with it.
2. Keep its imports from `@house-rules/stack`. Change nothing else until its tests pass in your app.
3. Spread its block lists into your model: `aggregates: [...Notes.aggregates, Recipe]`. Merge its `handlers` and provide its adapters, as [src/tests/compose.test.ts](packages/domain/src/tests/compose.test.ts) does for all of them.
4. Change it to fit your app. Its README is now yours; keep it in step with the code.

## Rules for a copy

- An app that already has data from a module, for example from an older `@house-rules/stack` that shipped it, copies the module with every event tag, field and aggregate, view and policy name unchanged. Its stored events then decode as before, with no data migration. Change it only after its tests and your stored data load from the copy.
- An event tag is the name of stored data. Before your app has data, rename freely. After it has data, never rename or remove an event tag or field; add fields with a decoding default, the way `WorkItemCreated` decodes `priority` as `null`.
- Event tags stay unique across the model. `Domain.verify(App)` reports duplicates.
- Every rule in [AGENTS.md](../../AGENTS.md) applies to the copy as to your own code: `Session` and `Forbidden` on client commands, `requirePermission` first in `decide`, `by` and `for` on events, system actors with explicit grants.
- A copy does not follow this folder. When a module here gets a fix, read its diff and apply what your app needs.
- Delete what your app does not use.

## Tests

`pnpm test` runs every module's tests here on Postgres and on `Domain.InMemory`, together with [compose.test.ts](packages/domain/src/tests/compose.test.ts), which hosts all modules in one model, and [new-app.test.ts](packages/domain/src/tests/new-app.test.ts), the small app the [stack README](../../packages/stack/README.md) walks through.

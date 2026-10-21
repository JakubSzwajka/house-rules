# @house-rules/comments: notes for agents

## What it does

Comments owns flat, plain-text comments on the app's targets. `Comments` captures its storage and the required `CommentTargets` host port. User methods take an explicit Actor and return Effects with no requirements. Version 0.2.0 peers on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Published packages load built `dist/`; this workspace loads source.

## Mount and bind

1. [ ] Fill `CommentTargets` in composition with a layer that calls the host module's relation method. Map host failures to `CommentTargetsUnavailable`. There is no default host port.
2. [ ] Mount `Comments.layerPostgres({ ...Comments.presets.default, targets: ["your-kind"] })` with that layer and the shared SQL client. Tests use `layerMemory(options)`; raw `layer(options)` also needs `CommentStore`.
3. [ ] Register `{ "package": "@house-rules/comments" }` in `migrations.json`, or `{ "workspace": "packages/comments" }` in this repo.
4. [ ] Acquire `Comments` once, call `bindComments(service)` and add its bindings to the app's `Runtime`. App features declare edges to `CommentsOperations`. Only features are exposed.
5. [ ] Share the app's unit adapter. Call `comments.removeTarget(ref)` in the target-deletion unit and `comments.erase(authorId)` in the account-deletion unit.
6. [ ] Test allowed and denied actors. Do not expose a write or destructive MCP tool without the owner's approval.

The browser-safe `./contract` door exports schemas, errors, permissions and `CommentsOperations`, never bindings or application values. `defineOperation` declares each operation; `bindComments` uses `bindOperation`. Main adds the service, binder, host port, storage and policy.

| CommentsOperations member / name | Permission | Flags |
| --- | --- | --- |
| `listComments` / `list_comments` | `comments:read` | readOnly |
| `addComment` / `add_comment` | `comments:write` | transactional |
| `editComment` / `edit_comment` | `comments:write` | transactional |
| `removeComment` / `remove_comment` | `comments:write` | transactional, destructive |

Each has empty edges and no approval flag. All require a person; non-person calls fail with `CommentTargetNotFound`, revealing no target. Binders capture the service once and never open a unit.

## Options and fixed rules

All options are required: allowed `targets`, positive integer `maxBodyLength` and `maxPageSize`. The partial default preset supplies 4000 UTF-16 code units and page size 100, never target kinds. Times and cursors use epoch milliseconds. Lists sort oldest first by createdAt then id and return an exclusive `next` cursor.

- Owners read, write and moderate. Members read and write. No relation, missing rows and denied access all fail with `CommentTargetNotFound`.
- Only authors edit. Authors remove their own comments while still owner or member; only owners remove someone else's. `comments:moderate` remains available for separate app policy.
- Unknown target kinds fail decoding before the host port runs. Descriptors accept kind strings because the mount owns the allowed set.
- Writes require an open unit and fail `NoOpenUnit` outside one. The module never opens it.
- Targets are plain kind/id columns, with no cross-module foreign keys. The host owns deletion hooks and target access.
- Errors carry not_found, invalid or unavailable kinds at definition. Ways can override messages, never status or code.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.
- Body text is plain text, never rendered as markdown here. Deletes are hard. No threads, history, events or notifications.

Consumers whose rules preset needs explicit contract trust add `@house-rules/comments` to `trustedContractPackages`; only `/contract` is trusted. Run package `typecheck`, `test` and `build`. The shared store suite uses memory and real Postgres.

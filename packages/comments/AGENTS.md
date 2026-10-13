# @house-rules/comments: notes for agents

## What it does

A private support module for flat, plain-text comments on an app's targets. `Comments` uses `defineModule`, captures storage and the host port, and takes an explicit Actor on user methods. It ships four browser-safe contracts at `@house-rules/comments/contract`. It is not published yet.

## How an app mounts it

1. [ ] Fill `CommentTargets` in the composition root with a layer that calls your own module's relation method. Map its failures to `CommentTargetsUnavailable`. There is no default host port.
2. [ ] Provide that layer to the module, beside the app's SQL client:

   ```ts
   const comments = Comments.layerPostgres({ ...Comments.presets.default, targets: ["your-kind"] }).pipe(
     Layer.provide(targetRelations), Layer.provide(database),
   );
   ```

   Tests and apps with no database use `Comments.layerMemory(options)`. The raw `Comments.layer(options)` needs `CommentStore` too. Both adapters are exported.

3. [ ] Add the module to the root `migrations.json`:

   ```json
   { "workspace": "packages/comments" }
   ```

4. [ ] Use `implement(contract, handler)` in thin use-cases. Yield `Viewer` and pass its Actor to `Comments`. Keep the app's Grant at the request boundary.
5. [ ] Call `Comments.removeTarget(ref)` when the app deletes a target, in the same unit. Call `Comments.erase(authorId)` when it deletes a user.

`Comments.presets.default` is partial data: body length 4000 UTF-16 code units and page size 100. Spread it and supply `targets`; the app must choose its kinds. All options are required, with positive integer limits. Times and cursors use epoch milliseconds. Lists sort oldest first by createdAt then id and return an exclusive `next` cursor.

## Fixed rules

- No cross-module foreign keys. Targets are plain kind/id columns. The app owns target access and deletion hooks.
- Owners read, write and moderate. Members read and write. No relation, a missing target or comment, and denied object access all fail with `CommentTargetNotFound`.
- Only authors edit. Authors remove their own comments while still owner or member; only owners remove someone else's. `removeComment` needs `comments:write` at the Grant. The module checks moderation per target. `comments:moderate` is exported for an app's separate moderator contract.
- Writes join an open unit; none starts one. Every write fails with `NoOpenUnit` outside it. The shipped write contracts set `transactional: true`.
- Body text is never rendered as markdown here. Deletes are hard. No threads, history, events or notifications.
- Unknown target kinds fail schema decoding at the module boundary, before the host port runs. The static contracts accept kind strings because only the mount knows the allowed set.

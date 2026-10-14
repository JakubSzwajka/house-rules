# @house-rules/comments: notes for agents

## What it does

A domain addition: a public support module for flat, plain-text comments on an app's targets. `Comments` uses `defineModule` from `@house-rules/domain`, captures storage and the host port, and takes an explicit Actor on user methods. It ships four browser-safe contracts at `@house-rules/comments/contract`, built with `@house-rules/application/contract`. Version 0.2.0 is ready for release, not yet published; 0.1.0 is on npm. It peers on exact `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3, and ships built JavaScript and declarations in `dist/`.

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
   { "package": "@house-rules/comments" }
   ```

   Use `{ "workspace": "packages/comments" }` only for this repo's source workspace.

   On rules 0.17.0, a consumer contract that imports this package needs `trustedContractPackages: ["@house-rules/comments"]` in its existing `layout(...)` options. Only `/contract` is trusted; the packed-consumer check verifies its transitive browser safety.

4. [ ] Use `implement(contract, handler)` from `@house-rules/application` in thin use-cases. Yield `CurrentActor` and pass the Actor to `Comments`. Keep the app's Grant at the request boundary.
5. [ ] Give `Comments` the same `SqlClient` layer, and the same `sqlUnitOfWork`, as the app's other stores. One unit then covers all their writes.
6. [ ] Add a view for each failure tag the shipped contracts declare, such as `CommentTargetNotFound`, and for `CommentTargetsUnavailable`. A missing view fails `tsc`.
7. [ ] Call `Comments.removeTarget(ref)` when the app deletes a target, in the same unit. Call `Comments.erase(authorId)` when it deletes a user.
8. [ ] Test through the composition with an allowed and a denied actor, and check that leaving `CommentTargets` unfilled fails the app layer's type check. Add no route or tool until the app has real identity and the owner approves it.

`Comments.presets.default` is partial data: body length 4000 UTF-16 code units and page size 100. Spread it and supply `targets`; the app must choose its kinds. All options are required, with positive integer limits. Times and cursors use epoch milliseconds. Lists sort oldest first by createdAt then id and return an exclusive `next` cursor.

## Fixed rules

- `CommentTargets` is a host port: the app fills it in the composition root. The module checks object-level access with it; the app's Grant checks the action.
- No cross-module foreign keys. Targets are plain kind/id columns. The app owns target access and deletion hooks.
- Owners read, write and moderate. Members read and write. No relation, a missing target or comment, and denied object access all fail with `CommentTargetNotFound`.
- Only authors edit. Authors remove their own comments while still owner or member; only owners remove someone else's. `removeComment` needs `comments:write` at the Grant. The module checks moderation per target. `comments:moderate` is exported for an app's separate moderator contract.
- Writes join an open unit; none starts one. Every write fails with `NoOpenUnit` outside it. The shipped write contracts set `transactional: true`.
- Body text is never rendered as markdown here. Deletes are hard. No threads, history, events or notifications.
- Unknown target kinds fail schema decoding at the module boundary, before the host port runs. The static contracts accept kind strings because only the mount knows the allowed set.

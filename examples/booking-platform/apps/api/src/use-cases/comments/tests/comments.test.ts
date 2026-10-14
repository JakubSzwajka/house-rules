import { Bookings } from "@example/bookings";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { call, composition, Grant, CurrentActor } from "@house-rules/application";
import { Comments, CommentInputInvalid, CommentTargets } from "@house-rules/comments";
import { Context, Effect, Layer } from "effect";
import { commentTargets } from "../../../composition/app-layer.js";
import { commentViews } from "../../../composition/views.js";
import { addComment } from "../add-comment.js";
import { editComment } from "../edit-comment.js";
import { listComments } from "../list-comments.js";
import { removeComment } from "../remove-comment.js";

const actorA = Actor.make({ id: ActorId.make("a") });
const actorB = Actor.make({ id: ActorId.make("b") });
const options = { ...Comments.presets.default, targets: ["booking"] };
const world = Layer.merge(
  Comments.layerMemory(options).pipe(
    Layer.provide(commentTargets),
    Layer.provideMerge(
      Bookings.fromRecords([{ id: "1", guestName: "Ada", ownerId: actorA.id, status: "active" }]),
    ),
  ),
  memoryUnitOfWork,
);
const caller = (actor: Actor) => () =>
  Effect.succeed(
    Context.make(CurrentActor, actor).pipe(
      Context.add(Grant, Grant.fromPermissions(["comments:read", "comments:write"])),
    ),
  );
const incoming = { headers: new Headers(), url: "https://example.test" };

it.effect("runs all four use-cases through composition and hides A's target from B", () =>
  Effect.gen(function* () {
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => composition({ layer: world, caller: caller(actorA), views: commentViews })),
      (app) => Effect.promise(() => app.dispose()),
    );
    const target = { kind: "booking", id: "1" };
    const added = yield* Effect.promise(() =>
      call(app, addComment, { target, body: "first" }, incoming),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = added.value.id;
    const listed = yield* Effect.promise(() =>
      call(app, listComments, { target, page: { size: 20 } }, incoming),
    );
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.items).toEqual([added.value]);
    const missing = yield* Effect.promise(() =>
      call(
        app,
        listComments,
        { target: { kind: "booking", id: "missing" }, page: { size: 20 } },
        incoming,
      ),
    );
    expect(missing.ok).toBe(false);
    const denied = [
      yield* Effect.promise(() =>
        call(app, listComments, { target, page: { size: 20 } }, incoming, {
          caller: caller(actorB),
        }),
      ),
      yield* Effect.promise(() =>
        call(app, addComment, { target, body: "no" }, incoming, { caller: caller(actorB) }),
      ),
      yield* Effect.promise(() =>
        call(app, editComment, { id, body: "no" }, incoming, { caller: caller(actorB) }),
      ),
      yield* Effect.promise(() =>
        call(app, removeComment, { id }, incoming, { caller: caller(actorB) }),
      ),
    ];
    if (!missing.ok)
      for (const result of denied) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error?._tag).toBe("CommentTargetNotFound");
          expect(result.view).toEqual(missing.view);
          expect(result.view.status).toBe(404);
        }
      }
    const edited = yield* Effect.promise(() =>
      call(app, editComment, { id, body: "edited" }, incoming),
    );
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.value.body).toBe("edited");
      expect(edited.value.editedAt).toBeTypeOf("number");
    }
    const removed = yield* Effect.promise(() => call(app, removeComment, { id }, incoming));
    expect(removed.ok).toBe(true);
    const empty = yield* Effect.promise(() =>
      call(app, listComments, { target, page: { size: 20 } }, incoming),
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.items).toEqual([]);
    const forbidden = yield* Effect.promise(() =>
      call(app, listComments, { target, page: { size: 20 } }, incoming, {
        caller: () =>
          Effect.succeed(
            Context.make(CurrentActor, actorA).pipe(Context.add(Grant, Grant.fromPermissions([]))),
          ),
      }),
    );
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error?._tag).toBe("Forbidden");
  }).pipe(Effect.scoped),
);

it("keeps CommentTargets as a required host port, including on adapter layers", () => {
  expectTypeOf(Comments.layerMemory(options)).toEqualTypeOf<
    Layer.Layer<Comments, CommentInputInvalid, CommentTargets>
  >();
  expectTypeOf(Comments.layerMemory(options)).not.toExtend<
    Layer.Layer<Comments, CommentInputInvalid>
  >();
});

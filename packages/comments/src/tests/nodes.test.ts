import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineEntry,
  Forbidden,
  May,
  NodeRuntime,
  runEntry,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  addComment,
  bindComments,
  Comments,
  CommentTargetNotFound,
  CommentTargets,
  editComment,
  listComments,
  removeComment,
} from "../index.js";
import * as contract from "../contract.js";

expectTypeOf<Parameters<typeof bindComments>[0]>().toExtend<Comments["Service"]>();
expectTypeOf<Comments["Service"]>().toExtend<Parameters<typeof bindComments>[0]>();

const owner = Actor.make({ id: ActorId.make("owner") });
const other = Actor.make({ id: ActorId.make("other") });
const nodes = [listComments, addComment, editComment, removeComment] as const;
const list = defineEntry(listComments);
const add = defineEntry(addComment);
const edit = defineEntry(editComment);
const remove = defineEntry(removeComment);
const system = { kind: "system", reason: "test", startedBy: "hook:test" } as const;
const systemList = defineEntry(listComments, { start: system });
const systemAdd = defineEntry(addComment, { start: system });
const systemEdit = defineEntry(editComment, { start: system });
const systemRemove = defineEntry(removeComment, { start: system });
const entries = [list, add, edit, remove, systemList, systemAdd, systemEdit, systemRemove];
const permissions = ["comments:read", "comments:write"] as const;
const targets = Layer.succeed(CommentTargets, {
  relation: (actor) => Effect.succeed(actor.id === owner.id ? "owner" : "none"),
});
const module = Comments.layerMemory({
  targets: ["test"],
  maxBodyLength: 100,
  maxPageSize: 10,
}).pipe(Layer.provide(targets));
const world = Layer.unwrap(
  Effect.gen(function* () {
    return NodeRuntime.layer({ bindings: bindComments(yield* Comments), entries, ways: [] });
  }),
).pipe(
  Layer.provideMerge(module),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const as = (actor: Actor, allowed: readonly (typeof permissions)[number][] = permissions) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(
      May.context(May.fixed(entries, allowed), { system: permissions, via: "test" }),
    ),
  );

it.layer(world)("Comments nodes", (test) => {
  test.effect("contract door exports descriptors only, with literal flags and no approval", () =>
    Effect.sync(() => {
      expect(Object.keys(contract)).not.toContain("bindComments");
      expect(listComments.readOnly).toBe(true);
      expect(removeComment.destructive).toBe(true);
      for (const node of nodes) {
        expect(node.edges).toEqual([]);
        expect(node.transactional).toBe(node !== listComments);
        expect(node.needsApproval).toBe(false);
        expect(node.permission).toBe(node === listComments ? "comments:read" : "comments:write");
      }
    }),
  );
  test.effect("entries capture the service, transact writes and retain object privacy", () =>
    Effect.gen(function* () {
      const target = { kind: "test", id: "one" };
      const first = yield* runEntry(add, { target, body: "first" }).pipe(Effect.provide(as(owner)));
      expect(
        (yield* runEntry(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(owner))))
          .items,
      ).toHaveLength(1);
      expect(
        (yield* runEntry(edit, { id: first.id, body: "changed" }).pipe(Effect.provide(as(owner))))
          .body,
      ).toBe("changed");
      expect(
        yield* Effect.flip(
          runEntry(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(other))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runEntry(edit, { id: first.id, body: "steal" }).pipe(Effect.provide(as(other))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runEntry(add, { target, body: "denied" }).pipe(Effect.provide(as(owner, []))),
        ),
      ).toBeInstanceOf(Forbidden);
      yield* runEntry(remove, { id: first.id }).pipe(Effect.provide(as(owner)));
      expect(
        (yield* runEntry(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(owner))))
          .items,
      ).toEqual([]);
    }),
  );
  test.effect("all non-person bindings hide the target, even with system permissions", () =>
    Effect.gen(function* () {
      const target = { kind: "test", id: "hidden" };
      expect(
        yield* Effect.flip(
          runEntry(systemList, { target, page: { size: 1 } }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runEntry(systemAdd, { target, body: "no" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runEntry(systemEdit, { id: "hidden", body: "no" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runEntry(systemRemove, { id: "hidden" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
    }),
  );
});

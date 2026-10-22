import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  Forbidden,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  CommentsOperations,
  bindComments,
  Comments,
  CommentTargetNotFound,
  CommentTargets,
} from "../index.js";
import * as contract from "../contract.js";

const { listComments, addComment, editComment, removeComment } = CommentsOperations;

expectTypeOf<Parameters<typeof bindComments>[0]>().toExtend<Comments["Service"]>();
expectTypeOf<Comments["Service"]>().toExtend<Parameters<typeof bindComments>[0]>();

const owner = Actor.make({ id: ActorId.make("owner") });
const other = Actor.make({ id: ActorId.make("other") });
const nodes = [listComments, addComment, editComment, removeComment] as const;
const list = defineFeature("test_list", {
  ...listComments,
  permission: null,
  flags: { readOnly: listComments.readOnly },
  edges: [listComments],

  handler: (input, { call }) => call(listComments, input),
});
const add = defineFeature("test_add", {
  ...addComment,
  permission: null,
  flags: { readOnly: addComment.readOnly },
  edges: [addComment],

  handler: (input, { call }) => call(addComment, input),
});
const edit = defineFeature("test_edit", {
  ...editComment,
  permission: null,
  flags: { readOnly: editComment.readOnly },
  edges: [editComment],

  handler: (input, { call }) => call(editComment, input),
});
const remove = defineFeature("test_remove", {
  ...removeComment,
  permission: null,
  flags: { readOnly: removeComment.readOnly },
  edges: [removeComment],

  handler: (input, { call }) => call(removeComment, input),
});
const system = { kind: "system", reason: "test", startedBy: "hook:test" } as const;
const systemList = defineFeature("test_systemList", {
  ...listComments,
  permission: null,
  flags: { readOnly: listComments.readOnly },
  edges: [listComments],
  start: system,
  handler: (input, { call }) => call(listComments, input),
});
const systemAdd = defineFeature("test_systemAdd", {
  ...addComment,
  permission: null,
  flags: { readOnly: addComment.readOnly },
  edges: [addComment],
  start: system,
  handler: (input, { call }) => call(addComment, input),
});
const systemEdit = defineFeature("test_systemEdit", {
  ...editComment,
  permission: null,
  flags: { readOnly: editComment.readOnly },
  edges: [editComment],
  start: system,
  handler: (input, { call }) => call(editComment, input),
});
const systemRemove = defineFeature("test_systemRemove", {
  ...removeComment,
  permission: null,
  flags: { readOnly: removeComment.readOnly },
  edges: [removeComment],
  start: system,
  handler: (input, { call }) => call(removeComment, input),
});
const features = [list, add, edit, remove, systemList, systemAdd, systemEdit, systemRemove];
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
    return Runtime.layer({
      mounts: [
        { service: Comments, operations: Object.values(CommentsOperations), bind: bindComments },
      ],
      features,
      ways: [],
    });
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
      May.context(May.fixed(allowed), { features, system: permissions, via: "test" }),
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
  test.effect("features capture the service, transact writes and retain object privacy", () =>
    Effect.gen(function* () {
      const target = { kind: "test", id: "one" };
      const first = yield* runFeature(add, { target, body: "first" }).pipe(
        Effect.provide(as(owner)),
      );
      expect(
        (yield* runFeature(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(owner))))
          .items,
      ).toHaveLength(1);
      expect(
        (yield* runFeature(edit, { id: first.id, body: "changed" }).pipe(Effect.provide(as(owner))))
          .body,
      ).toBe("changed");
      expect(
        yield* Effect.flip(
          runFeature(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(other))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runFeature(edit, { id: first.id, body: "steal" }).pipe(Effect.provide(as(other))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runFeature(add, { target, body: "denied" }).pipe(Effect.provide(as(owner, []))),
        ),
      ).toBeInstanceOf(Forbidden);
      yield* runFeature(remove, { id: first.id }).pipe(Effect.provide(as(owner)));
      expect(
        (yield* runFeature(list, { target, page: { size: 10 } }).pipe(Effect.provide(as(owner))))
          .items,
      ).toEqual([]);
    }),
  );
  test.effect("all non-person bindings hide the target, even with system permissions", () =>
    Effect.gen(function* () {
      const target = { kind: "test", id: "hidden" };
      expect(
        yield* Effect.flip(
          runFeature(systemList, { target, page: { size: 1 } }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runFeature(systemAdd, { target, body: "no" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runFeature(systemEdit, { id: "hidden", body: "no" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
      expect(
        yield* Effect.flip(
          runFeature(systemRemove, { id: "hidden" }).pipe(Effect.provide(as(owner))),
        ),
      ).toBeInstanceOf(CommentTargetNotFound);
    }),
  );
});

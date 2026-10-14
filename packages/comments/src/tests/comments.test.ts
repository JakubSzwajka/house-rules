import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  Comments,
  CommentTargets,
  CommentTargetNotFound,
  CommentInputInvalid,
  commentPolicy,
  CommentPermissions,
} from "../index.js";

const owner = Actor.make({ id: ActorId.make("owner") });
const member = Actor.make({ id: ActorId.make("member") });
const secondMember = Actor.make({ id: ActorId.make("second-member") });
let revoked = false;
const targets = Layer.succeed(
  CommentTargets,
  CommentTargets.of({
    relation: (actor, ref) =>
      Effect.sync(() =>
        ref.id === "missing" || (actor.id === member.id && revoked)
          ? "none"
          : actor.id === owner.id
            ? "owner"
            : actor.id === member.id || actor.id === secondMember.id
              ? "member"
              : "none",
      ),
  }),
);
const world = Comments.layerMemory({
  targets: ["booking"],
  maxBodyLength: 10,
  maxPageSize: 2,
}).pipe(Layer.provide(targets), Layer.provideMerge(memoryUnitOfWork));

it.effect("the who × action table covers owners, members and outsiders", () =>
  Effect.sync(() => {
    expect(commentPolicy.table()).toEqual({
      owner: { "comments:read": true, "comments:write": true, "comments:moderate": true },
      member: { "comments:read": true, "comments:write": true, "comments:moderate": false },
      none: { "comments:read": false, "comments:write": false, "comments:moderate": false },
    });
    for (const relation of ["owner", "member", "none"] as const)
      for (const permission of Object.values(CommentPermissions))
        expect(commentPolicy.allows(relation, permission)).toBe(
          commentPolicy.table()[relation][permission],
        );
  }),
);

it.layer(world)("Comments", (test) => {
  test.effect("caps pages and bodies and rejects unknown kinds at decode before host lookup", () =>
    Effect.gen(function* () {
      const comments = yield* Comments;
      const ref = { kind: "booking", id: "limits" };
      const exact = yield* UnitOfWork.atomic(comments.add(owner, ref, "1234567890"));
      expect(exact.body).toBe("1234567890");
      expect(
        yield* Effect.flip(UnitOfWork.atomic(comments.add(owner, ref, "12345678901"))),
      ).toBeInstanceOf(CommentInputInvalid);
      expect(
        yield* Effect.flip(UnitOfWork.atomic(comments.edit(owner, exact.id, "12345678901"))),
      ).toBeInstanceOf(CommentInputInvalid);
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(comments.add(owner, { kind: "other", id: "x" }, "ok")),
        ),
      ).toBeInstanceOf(CommentInputInvalid);
      expect(
        yield* Effect.flip(comments.list(owner, { kind: "other", id: "x" }, { size: 1 })),
      ).toBeInstanceOf(CommentInputInvalid);
      yield* UnitOfWork.atomic(comments.add(owner, ref, "two"));
      yield* UnitOfWork.atomic(comments.add(owner, ref, "three"));
      const first = yield* comments.list(owner, ref, { size: 99 });
      expect(first.items).toHaveLength(2);
      expect(first.next).toBeDefined();
      if (first.next === undefined) return yield* Effect.die("Expected next cursor");
      const second = yield* comments.list(owner, ref, { size: 99, after: first.next });
      expect(second.items).toHaveLength(1);
      expect(second.next).toBeUndefined();
      expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
      expect(yield* Effect.flip(comments.list(owner, ref, { size: 0 }))).toBeInstanceOf(
        CommentInputInvalid,
      );
    }),
  );
  test.effect(
    "authors edit and remove, members cannot moderate, owners remove others but cannot edit them",
    () =>
      Effect.gen(function* () {
        const comments = yield* Comments;
        const ref = { kind: "booking", id: "moderation" };
        const first = yield* UnitOfWork.atomic(comments.add(member, ref, "member"));
        expect((yield* UnitOfWork.atomic(comments.edit(member, first.id, "edited"))).body).toBe(
          "edited",
        );
        expect(
          yield* Effect.flip(UnitOfWork.atomic(comments.edit(owner, first.id, "owner"))),
        ).toBeInstanceOf(CommentTargetNotFound);
        expect(
          yield* Effect.flip(UnitOfWork.atomic(comments.remove(secondMember, first.id))),
        ).toBeInstanceOf(CommentTargetNotFound);
        yield* UnitOfWork.atomic(comments.remove(owner, first.id));
        const own = yield* UnitOfWork.atomic(comments.add(member, ref, "own"));
        yield* UnitOfWork.atomic(comments.remove(member, own.id));
        expect((yield* comments.list(owner, ref, { size: 2 })).items).toEqual([]);
      }),
  );
  test.effect("a former member cannot edit or remove their own comment", () =>
    Effect.gen(function* () {
      const comments = yield* Comments;
      const own = yield* UnitOfWork.atomic(
        comments.add(member, { kind: "booking", id: "revoked" }, "own"),
      );
      revoked = true;
      expect(yield* Effect.flip(UnitOfWork.atomic(comments.edit(member, own.id, "no")))).toEqual(
        new CommentTargetNotFound(),
      );
      expect(yield* Effect.flip(UnitOfWork.atomic(comments.remove(member, own.id)))).toEqual(
        new CommentTargetNotFound(),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          revoked = false;
        }),
      ),
    ),
  );
  test.effect("all module writes fail outside a unit", () =>
    Effect.gen(function* () {
      const comments = yield* Comments;
      for (const call of [
        comments.add(owner, { kind: "booking", id: "no-unit" }, "ok"),
        comments.edit(owner, "missing", "ok"),
        comments.remove(owner, "missing"),
        comments.removeTarget({ kind: "booking", id: "missing" }),
        comments.erase(owner.id),
      ])
        expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
    }),
  );
});

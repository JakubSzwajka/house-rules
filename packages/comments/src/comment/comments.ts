import { type Actor, UnitOfWork } from "@house-rules/capability";
import { DateTime, Effect, Random, Schema } from "effect";
import type { CommentStore } from "../storage.js";
import type { CommentTargets } from "./comment-targets.js";
import {
  CommentInputInvalid,
  CommentPage,
  CommentTarget,
  CommentTargetNotFound,
} from "./comment.js";
import type { CommentsOptions } from "./options.js";
import { CommentPermissions } from "./permissions.js";
import { commentPolicy } from "./policy.js";

export const makeComments = (
  store: CommentStore["Service"],
  targets: CommentTargets["Service"],
  options: CommentsOptions,
) => {
  const decodeTarget = Schema.decodeEffect(
    Schema.Struct({
      kind: Schema.Literals(options.targets),
      id: CommentTarget.fields.id,
    }),
  );
  const decodeBody = Schema.decodeEffect(
    Schema.String.check(Schema.isMaxLength(options.maxBodyLength)),
  );
  const invalid = () => new CommentInputInvalid({ message: "Invalid comment input." });
  const requireRelation = Effect.fn("Comments.requireRelation")(function* (
    actor: Actor,
    ref: CommentTarget,
  ) {
    const target = yield* decodeTarget(ref).pipe(Effect.mapError(invalid));
    const relation = yield* targets.relation(actor, target);
    if (!commentPolicy.allows(relation, CommentPermissions.read))
      return yield* new CommentTargetNotFound();
    return relation;
  });
  const findAccessible = Effect.fn("Comments.findAccessible")(function* (actor: Actor, id: string) {
    const comment = yield* store.find(id);
    if (comment === undefined) return yield* new CommentTargetNotFound();
    const relation = yield* requireRelation(actor, comment.target);
    return { comment, relation };
  });
  return {
    list: Effect.fn("Comments.list")(function* (
      actor: Actor,
      ref: CommentTarget,
      page: CommentPage,
    ) {
      yield* requireRelation(actor, ref);
      const decoded = yield* Schema.decodeEffect(CommentPage)(page).pipe(Effect.mapError(invalid));
      const size = Math.min(decoded.size, options.maxPageSize);
      const rows = yield* store.list(ref, { ...decoded, size: size + 1 });
      const items = rows.slice(0, size);
      const last = items[items.length - 1];
      return rows.length > size && last !== undefined
        ? { items, next: { createdAt: last.createdAt, id: last.id } }
        : { items };
    }),
    add: Effect.fn("Comments.add")(function* (actor: Actor, ref: CommentTarget, body: string) {
      yield* UnitOfWork.required;
      yield* requireRelation(actor, ref);
      const decoded = yield* decodeBody(body).pipe(Effect.mapError(invalid));
      const comment = {
        id: yield* Effect.all(
          Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
        ).pipe(
          Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
        ),
        target: { ...ref },
        authorId: actor.id,
        body: decoded,
        createdAt: DateTime.toEpochMillis(yield* DateTime.now),
      };
      yield* store.insert(comment);
      return comment;
    }),
    edit: Effect.fn("Comments.edit")(function* (actor: Actor, id: string, body: string) {
      yield* UnitOfWork.required;
      const { comment } = yield* findAccessible(actor, id);
      if (comment.authorId !== actor.id) return yield* new CommentTargetNotFound();
      const decoded = yield* decodeBody(body).pipe(Effect.mapError(invalid));
      const edited = yield* store.edit(id, decoded, DateTime.toEpochMillis(yield* DateTime.now));
      if (edited === undefined) return yield* new CommentTargetNotFound();
      return edited;
    }),
    remove: Effect.fn("Comments.remove")(function* (actor: Actor, id: string) {
      yield* UnitOfWork.required;
      const { comment, relation } = yield* findAccessible(actor, id);
      if (
        comment.authorId !== actor.id &&
        !commentPolicy.allows(relation, CommentPermissions.moderate)
      ) {
        return yield* new CommentTargetNotFound();
      }
      yield* store.remove(id);
    }),
    removeTarget: Effect.fn("Comments.removeTarget")(function* (ref: CommentTarget) {
      yield* UnitOfWork.required;
      const target = yield* decodeTarget(ref).pipe(Effect.mapError(invalid));
      yield* store.removeTarget(target);
    }),
    erase: Effect.fn("Comments.erase")(function* (authorId: string) {
      yield* UnitOfWork.required;
      yield* store.erase(authorId);
    }),
  };
};

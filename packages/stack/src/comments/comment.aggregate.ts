import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { can } from "../access/permission.ts";
import { requirePermission } from "../access/require-permission.ts";
import { authorOf } from "../actor/actor.ts";
import { AddComment, CommentAdded, CommentExists } from "./add-comment.command.ts";
import { CommentId } from "./comment.id.ts";
import { CommentNotFound } from "./comment-not-found.rejection.ts";
import { tooLong } from "./comment-too-long.rejection.ts";
import { CommentDeleted, DeleteComment } from "./delete-comment.command.ts";
import { CommentEdited, EditComment } from "./edit-comment.command.ts";
import { NotAuthor } from "./not-author.rejection.ts";
import { CommentsPermissions } from "./permissions.ts";
import { Target } from "../target/target.ts";

const Posted = Schema.TaggedStruct("Posted", {
  target: Target,
  by: Schema.String,
  body: Schema.String,
});

export const CommentState = Schema.Union([
  Schema.TaggedStruct("None", {}),
  Posted,
  Schema.TaggedStruct("Deleted", {}),
]);
export type CommentState = typeof CommentState.Type;

const postedFor = (s: CommentState): typeof Posted.Type | CommentNotFound =>
  s._tag === "Posted" ? s : new CommentNotFound();

export class Comment extends Domain.Aggregate("Comment", {
  id: CommentId,
  state: CommentState,
  initial: { _tag: "None" },
  commands: [AddComment, EditComment, DeleteComment],
  decide: {
    AddComment: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(CommentsPermissions.write);
      if (s._tag !== "None") return yield* new CommentExists();
      const invalid = tooLong(cmd.body);
      if (invalid) return yield* invalid;
      return [new CommentAdded({ target: cmd.target, by: authorOf(actor), body: cmd.body })];
    }),
    EditComment: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(CommentsPermissions.write);
      const posted = postedFor(s);
      if (posted._tag !== "Posted") return yield* posted;
      if (posted.by !== authorOf(actor)) return yield* new NotAuthor({ author: posted.by });
      const invalid = tooLong(cmd.body);
      if (invalid) return yield* invalid;
      return [new CommentEdited({ target: posted.target, by: posted.by, body: cmd.body })];
    }),
    DeleteComment: Effect.fn(function* (s) {
      const actor = yield* requirePermission(CommentsPermissions.write);
      if (s._tag === "Deleted") return [];
      const posted = postedFor(s);
      if (posted._tag !== "Posted") return yield* posted;
      const by = authorOf(actor);
      if (posted.by !== by && !can(actor, CommentsPermissions.moderate))
        return yield* new NotAuthor({ author: posted.by });
      return [new CommentDeleted({ target: posted.target, by })];
    }),
  },
  evolve: {
    CommentAdded: (_, e) => ({ _tag: "Posted" as const, target: e.target, by: e.by, body: e.body }),
    CommentEdited: (s, e) => (s._tag === "Posted" ? { ...s, body: e.body } : s),
    CommentDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

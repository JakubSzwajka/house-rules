import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { Session } from "../auth/session.middleware.ts";
import { Comment } from "./comment.aggregate.ts";
import { CommentId } from "./comment.id.ts";
import { CommentsPermissions } from "./permissions.ts";
import { TargetKey, targetKey } from "../target/target.ts";

export const CommentItem = Schema.Struct({
  id: CommentId,
  by: Schema.String,
  body: Schema.String,
  postedAt: Schema.Int,
  editedAt: Schema.NullOr(Schema.Int),
});
export type CommentItem = typeof CommentItem.Type;

const oldestFirst = (a: CommentItem, b: CommentItem) =>
  a.postedAt - b.postedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class CommentsOnTarget extends Domain.View("CommentsOnTarget", {
  from: [Comment],
  key: TargetKey,
  middleware: [Session],
  rejects: [Forbidden],
  state: Schema.Struct({ comments: Schema.Array(CommentItem) }),
  initial: { comments: [] },
  keyOf: { Comment: ({ event }) => targetKey(event.target) },
  evolve: {
    CommentAdded: (v, e, { source, at }) => ({
      comments: [
        ...v.comments,
        {
          id: source.id,
          by: e.by,
          body: e.body,
          postedAt: DateTime.toEpochMillis(at),
          editedAt: null,
        },
      ].sort(oldestFirst),
    }),
    CommentEdited: (v, e, { source, at }) => ({
      comments: v.comments.map((c) =>
        c.id === source.id ? { ...c, body: e.body, editedAt: DateTime.toEpochMillis(at) } : c,
      ),
    }),
    CommentDeleted: (v, _, { source }) => ({
      comments: v.comments.filter((c) => c.id !== source.id),
    }),
  },
  validate: () => Effect.asVoid(requirePermission(CommentsPermissions.read)),
}) {}

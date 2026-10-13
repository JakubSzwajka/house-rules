import { Schema } from "effect";

export const CommentTarget = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type CommentTarget = typeof CommentTarget.Type;

export const CommentCursor = Schema.Struct({ createdAt: Schema.Int, id: Schema.NonEmptyString });
export type CommentCursor = typeof CommentCursor.Type;

export const CommentPage = Schema.Struct({
  size: Schema.Int.check(Schema.isGreaterThan(0)),
  after: Schema.optionalKey(CommentCursor),
});
export type CommentPage = typeof CommentPage.Type;

export const Comment = Schema.Struct({
  id: Schema.NonEmptyString,
  target: CommentTarget,
  authorId: Schema.NonEmptyString,
  body: Schema.String,
  createdAt: Schema.Int,
  editedAt: Schema.optionalKey(Schema.Int),
});
export type Comment = typeof Comment.Type;

export const CommentList = Schema.Struct({
  items: Schema.Array(Comment),
  next: Schema.optionalKey(CommentCursor),
});
export type CommentList = typeof CommentList.Type;

export class CommentTargetNotFound extends Schema.TaggedError<CommentTargetNotFound>()(
  "CommentTargetNotFound",
  {},
) {}

export class CommentInputInvalid extends Schema.TaggedError<CommentInputInvalid>()(
  "CommentInputInvalid",
  { message: Schema.String },
) {}

export class CommentStoreUnavailable extends Schema.TaggedError<CommentStoreUnavailable>()(
  "CommentStoreUnavailable",
  { cause: Schema.Defect() },
) {}

export class CommentTargetsUnavailable extends Schema.TaggedError<CommentTargetsUnavailable>()(
  "CommentTargetsUnavailable",
  { cause: Schema.Defect() },
) {}

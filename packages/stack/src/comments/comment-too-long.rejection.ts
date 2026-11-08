import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export const MAX_COMMENT_LENGTH = 4000;

export class CommentTooLong extends Domain.Rejection("CommentTooLong", {
  max: Schema.Int,
  length: Schema.Int,
}) {}

export const tooLong = (body: string): CommentTooLong | undefined =>
  body.length > MAX_COMMENT_LENGTH
    ? new CommentTooLong({ max: MAX_COMMENT_LENGTH, length: body.length })
    : undefined;

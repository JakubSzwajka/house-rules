import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session, Target } from "@house-rules/stack";
import { CommentId } from "./comment.id.ts";
import { CommentNotFound } from "./comment-not-found.rejection.ts";
import { NotAuthor } from "./not-author.rejection.ts";

export class CommentDeleted extends Domain.Event("CommentDeleted", {
  target: Target,
  by: Schema.String,
  for: ActedFor,
}) {}

export class DeleteComment extends Domain.Command("DeleteComment", {
  target: CommentId,
  middleware: [Session],
  events: [CommentDeleted],
  rejects: [Forbidden, CommentNotFound, NotAuthor],
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { CommentId } from "./comment.id.ts";
import { CommentNotFound } from "./comment-not-found.rejection.ts";
import { NotAuthor } from "./not-author.rejection.ts";
import { Target } from "../target/target.ts";

export class CommentDeleted extends Domain.Event("CommentDeleted", {
  target: Target,
  by: Schema.String,
}) {}

export class DeleteComment extends Domain.Command("DeleteComment", {
  target: CommentId,
  middleware: [Session],
  events: [CommentDeleted],
  rejects: [Forbidden, CommentNotFound, NotAuthor],
}) {}

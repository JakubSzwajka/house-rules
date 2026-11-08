import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { CommentId } from "./comment.id.ts";
import { CommentNotFound } from "./comment-not-found.rejection.ts";
import { CommentTooLong } from "./comment-too-long.rejection.ts";
import { NotAuthor } from "./not-author.rejection.ts";
import { Target } from "../target/target.ts";

export class CommentEdited extends Domain.Event("CommentEdited", {
  target: Target,
  by: Schema.String,
  body: Schema.String,
}) {}

export class EditComment extends Domain.Command("EditComment", {
  target: CommentId,
  middleware: [Session],
  input: { body: Schema.String },
  events: [CommentEdited],
  rejects: [Forbidden, CommentNotFound, NotAuthor, CommentTooLong],
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { CommentId } from "./comment.id.ts";
import { CommentTooLong } from "./comment-too-long.rejection.ts";
import { Target } from "../target/target.ts";

export class CommentExists extends Domain.Rejection("CommentExists", {}, { httpApiStatus: 409 }) {}

export class CommentAdded extends Domain.Event("CommentAdded", {
  target: Target,
  by: Schema.String,
  body: Schema.String,
}) {}

export class AddComment extends Domain.Command("AddComment", {
  target: CommentId,
  middleware: [Session],
  input: { target: Target, body: Schema.String },
  events: [CommentAdded],
  rejects: [Forbidden, CommentTooLong, CommentExists],
}) {}

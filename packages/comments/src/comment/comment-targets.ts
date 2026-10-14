import type { Actor } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { CommentTarget, CommentTargetsUnavailable } from "./comment.js";

export type CommentRelation = "owner" | "member" | "none";

export class CommentTargets extends Context.Service<
  CommentTargets,
  {
    readonly relation: (
      actor: Actor,
      ref: CommentTarget,
    ) => Effect.Effect<CommentRelation, CommentTargetsUnavailable>;
  }
>()("@house-rules/comments/CommentTargets") {}

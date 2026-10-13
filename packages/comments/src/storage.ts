import type { NoOpenUnit } from "@house-rules/capability";
import { Context, type Effect } from "effect";
import type {
  Comment,
  CommentPage,
  CommentStoreUnavailable,
  CommentTarget,
} from "./comment/comment.js";

export class CommentStore extends Context.Service<
  CommentStore,
  {
    readonly find: (id: string) => Effect.Effect<Comment | undefined, CommentStoreUnavailable>;
    readonly list: (
      ref: CommentTarget,
      page: CommentPage,
    ) => Effect.Effect<ReadonlyArray<Comment>, CommentStoreUnavailable>;
    readonly insert: (
      comment: Comment,
    ) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
    readonly edit: (
      id: string,
      body: string,
      editedAt: number,
    ) => Effect.Effect<Comment | undefined, CommentStoreUnavailable | NoOpenUnit>;
    readonly remove: (id: string) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
    readonly removeTarget: (
      ref: CommentTarget,
    ) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
    readonly erase: (authorId: string) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/comments/CommentStore") {}

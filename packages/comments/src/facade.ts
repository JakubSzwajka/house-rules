import { type Actor, defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryCommentStore } from "./adapters/memory/comment.js";
import { postgresCommentStore } from "./adapters/postgres/comment.js";
import { CommentTargets } from "./comment/comment-targets.js";
import {
  type Comment,
  CommentInputInvalid,
  type CommentList,
  type CommentPage,
  type CommentStoreUnavailable,
  type CommentTarget,
  type CommentTargetNotFound,
  type CommentTargetsUnavailable,
} from "./comment/comment.js";
import { makeComments } from "./comment/comments.js";
import { CommentsOptions } from "./comment/options.js";
import { CommentStore } from "./storage.js";

export type CommentFailure =
  | CommentInputInvalid
  | CommentStoreUnavailable
  | CommentTargetsUnavailable
  | CommentTargetNotFound;

export class Comments extends defineModule<
  Comments,
  {
    readonly list: (
      actor: Actor,
      ref: CommentTarget,
      page: CommentPage,
    ) => Effect.Effect<CommentList, CommentFailure>;
    readonly add: (
      actor: Actor,
      ref: CommentTarget,
      body: string,
    ) => Effect.Effect<Comment, CommentFailure | NoOpenUnit>;
    readonly edit: (
      actor: Actor,
      id: string,
      body: string,
    ) => Effect.Effect<Comment, CommentFailure | NoOpenUnit>;
    readonly remove: (actor: Actor, id: string) => Effect.Effect<void, CommentFailure | NoOpenUnit>;
    readonly removeTarget: (
      ref: CommentTarget,
    ) => Effect.Effect<void, CommentInputInvalid | CommentStoreUnavailable | NoOpenUnit>;
    readonly erase: (authorId: string) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
  }
>()("comments", {
  make: (options: CommentsOptions) =>
    Effect.gen(function* commentsLayer() {
      const settings = yield* Schema.decodeEffect(CommentsOptions)(options).pipe(
        Effect.mapError(() => new CommentInputInvalid({ message: "Invalid comments options." })),
      );
      const store = yield* CommentStore;
      const targets = yield* CommentTargets;
      return makeComments(store, targets, settings);
    }),
}) {
  static readonly presets = { default: { maxBodyLength: 4000, maxPageSize: 100 } } as const;

  static readonly layerMemory = (options: CommentsOptions) =>
    this.layer(options).pipe(Layer.provide(memoryCommentStore()));

  static readonly layerPostgres = (options: CommentsOptions) =>
    this.layer(options).pipe(Layer.provide(postgresCommentStore));
}

import { type Binding, bindNode } from "@house-rules/application";
import type { Actor, NoOpenUnit } from "@house-rules/domain";
import { Effect } from "effect";
import {
  type Comment,
  type CommentInputInvalid,
  type CommentList,
  type CommentPage,
  type CommentStoreUnavailable,
  type CommentTarget,
  CommentTargetNotFound,
  type CommentTargetsUnavailable,
} from "./comment.js";
import { addComment, editComment, listComments, removeComment } from "./nodes.js";

type Failure =
  | CommentInputInvalid
  | CommentStoreUnavailable
  | CommentTargetsUnavailable
  | CommentTargetNotFound;
type Service = {
  readonly list: (
    actor: Actor,
    ref: CommentTarget,
    page: CommentPage,
  ) => Effect.Effect<CommentList, Failure>;
  readonly add: (
    actor: Actor,
    ref: CommentTarget,
    body: string,
  ) => Effect.Effect<Comment, Failure | NoOpenUnit>;
  readonly edit: (
    actor: Actor,
    id: string,
    body: string,
  ) => Effect.Effect<Comment, Failure | NoOpenUnit>;
  readonly remove: (actor: Actor, id: string) => Effect.Effect<void, Failure | NoOpenUnit>;
  readonly removeTarget: (
    ref: CommentTarget,
  ) => Effect.Effect<void, CommentInputInvalid | CommentStoreUnavailable | NoOpenUnit>;
  readonly erase: (authorId: string) => Effect.Effect<void, CommentStoreUnavailable | NoOpenUnit>;
};

export const bindComments = (service: Service): readonly Binding[] => [
  bindNode(listComments, ({ target, page }, { caller }) =>
    caller.kind === "person"
      ? service.list(caller.actor, target, page)
      : Effect.fail(new CommentTargetNotFound()),
  ),
  bindNode(addComment, ({ target, body }, { caller }) =>
    caller.kind === "person"
      ? service.add(caller.actor, target, body)
      : Effect.fail(new CommentTargetNotFound()),
  ),
  bindNode(editComment, ({ id, body }, { caller }) =>
    caller.kind === "person"
      ? service.edit(caller.actor, id, body)
      : Effect.fail(new CommentTargetNotFound()),
  ),
  bindNode(removeComment, ({ id }, { caller }) =>
    caller.kind === "person"
      ? service.remove(caller.actor, id)
      : Effect.fail(new CommentTargetNotFound()),
  ),
];

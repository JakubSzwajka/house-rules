import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  Comment,
  CommentInputInvalid,
  CommentList,
  CommentPage,
  CommentStoreUnavailable,
  CommentTarget,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "./comment.js";
import { CommentPermissions } from "./permissions.js";

const failure = Schema.Union([
  CommentInputInvalid,
  CommentTargetNotFound,
  CommentStoreUnavailable,
  CommentTargetsUnavailable,
]);
const listComments = defineOperation("Comments.listComments", {
  description: "List comments on one target.",
  input: Schema.Struct({ target: CommentTarget, page: CommentPage }),
  output: CommentList,
  failure,
  permission: CommentPermissions.read,
  edges: [],
  readOnly: true,
});
const addComment = defineOperation("Comments.addComment", {
  description: "Add a plain-text comment to one target.",
  input: Schema.Struct({ target: CommentTarget, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
});
const editComment = defineOperation("Comments.editComment", {
  description: "Edit your own comment.",
  input: Schema.Struct({ id: Schema.NonEmptyString, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
});
const removeComment = defineOperation("Comments.removeComment", {
  description: "Remove your own comment or moderate a target you own.",
  input: Schema.Struct({ id: Schema.NonEmptyString }),
  output: Schema.Void,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
  destructive: true,
});

export const CommentsOperations = { listComments, addComment, editComment, removeComment } as const;

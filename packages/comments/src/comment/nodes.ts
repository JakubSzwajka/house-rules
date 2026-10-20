import { defineNode } from "@house-rules/domain/contract";
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
export const listComments = defineNode("list_comments", {
  description: "List comments on one target.",
  input: Schema.Struct({ target: CommentTarget, page: CommentPage }),
  output: CommentList,
  failure,
  permission: CommentPermissions.read,
  edges: [],
  readOnly: true,
});
export const addComment = defineNode("add_comment", {
  description: "Add a plain-text comment to one target.",
  input: Schema.Struct({ target: CommentTarget, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
});
export const editComment = defineNode("edit_comment", {
  description: "Edit your own comment.",
  input: Schema.Struct({ id: Schema.NonEmptyString, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
});
export const removeComment = defineNode("remove_comment", {
  description: "Remove your own comment or moderate a target you own.",
  input: Schema.Struct({ id: Schema.NonEmptyString }),
  output: Schema.Void,
  failure,
  permission: CommentPermissions.write,
  edges: [],
  transactional: true,
  destructive: true,
});

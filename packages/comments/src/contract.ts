import { defineContract } from "@house-rules/capability/contract";
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
} from "./comment/comment.js";
import { CommentPermissions } from "./comment/permissions.js";

export {
  Comment,
  CommentCursor,
  CommentInputInvalid,
  CommentList,
  CommentPage,
  CommentStoreUnavailable,
  CommentTarget,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "./comment/comment.js";
export { type CommentPermission, CommentPermissions } from "./comment/permissions.js";

const failure = Schema.Union([
  CommentInputInvalid,
  CommentTargetNotFound,
  CommentStoreUnavailable,
  CommentTargetsUnavailable,
]);

export const listComments = defineContract("list_comments", {
  description: "List comments on one target.",
  input: Schema.Struct({ target: CommentTarget, page: CommentPage }),
  output: CommentList,
  failure,
  permission: CommentPermissions.read,
  annotations: { readOnly: true },
});
export const addComment = defineContract("add_comment", {
  description: "Add a plain-text comment to one target.",
  input: Schema.Struct({ target: CommentTarget, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  transactional: true,
});
export const editComment = defineContract("edit_comment", {
  description: "Edit your own comment.",
  input: Schema.Struct({ id: Schema.NonEmptyString, body: Schema.String }),
  output: Comment,
  failure,
  permission: CommentPermissions.write,
  transactional: true,
});
export const removeComment = defineContract("remove_comment", {
  description: "Remove your own comment or moderate a target you own.",
  input: Schema.Struct({ id: Schema.NonEmptyString }),
  output: Schema.Void,
  failure,
  permission: CommentPermissions.write,
  transactional: true,
  annotations: { destructive: true },
});

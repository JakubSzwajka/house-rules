import { definePolicy } from "@house-rules/capability";
import { CommentPermissions } from "./permissions.js";

export const commentPolicy = definePolicy({
  owner: [CommentPermissions.read, CommentPermissions.write, CommentPermissions.moderate],
  member: [CommentPermissions.read, CommentPermissions.write],
  none: [],
});

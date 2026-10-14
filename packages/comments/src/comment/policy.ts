import { definePolicy } from "@house-rules/domain";
import { CommentPermissions } from "./permissions.js";

export const commentPolicy = definePolicy({
  owner: [CommentPermissions.read, CommentPermissions.write, CommentPermissions.moderate],
  member: [CommentPermissions.read, CommentPermissions.write],
  none: [],
});

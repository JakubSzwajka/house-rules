import type { MountDefinition } from "@house-rules/application";
import { Comments } from "./facade.js";
import { CommentsOperations } from "./contract.js";
import { bindComments } from "./comment/bind-comments.js";

export const CommentsMount = {
  map: { name: "comments", kind: "package", package: "@house-rules/comments" },
  service: Comments,
  operations: Object.values(CommentsOperations),
  bind: bindComments,
} satisfies MountDefinition<Comments, Comments["Service"]>;

export { bindComments } from "./comment/bind-comments.js";
export { Comments, type CommentFailure } from "./facade.js";
export { CommentStore } from "./storage.js";
export { CommentTargets, type CommentRelation } from "./comment/comment-targets.js";
export { CommentsOptions } from "./comment/options.js";
export { commentPolicy } from "./comment/policy.js";
export { memoryCommentStore } from "./adapters/memory/comment.js";
export { postgresCommentStore } from "./adapters/postgres/comment.js";
export {
  CommentsOperations,
  Comment,
  CommentCursor,
  CommentInputInvalid,
  CommentList,
  CommentPage,
  type CommentPermission,
  CommentPermissions,
  CommentStoreUnavailable,
  CommentTarget,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "./contract.js";

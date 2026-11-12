import { Comment } from "./comment.aggregate.ts";
import { CommentsOnTarget } from "./comments-on-target.view.ts";

export { AddComment, CommentAdded, CommentExists } from "./add-comment.command.ts";
export { Comment, CommentState } from "./comment.aggregate.ts";
export { CommentId } from "./comment.id.ts";
export { CommentNotFound } from "./comment-not-found.rejection.ts";
export { CommentTooLong, MAX_COMMENT_LENGTH } from "./comment-too-long.rejection.ts";
export { CommentItem, CommentsOnTarget } from "./comments-on-target.view.ts";
export { CommentDeleted, DeleteComment } from "./delete-comment.command.ts";
export { CommentEdited, EditComment } from "./edit-comment.command.ts";
export { NotAuthor } from "./not-author.rejection.ts";
export { CommentsPermissions } from "./permissions.ts";

export const aggregates = [Comment] as const;
export const views = [CommentsOnTarget] as const;

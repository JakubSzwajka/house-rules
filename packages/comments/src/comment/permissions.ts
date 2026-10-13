export const CommentPermissions = {
  read: "comments:read",
  write: "comments:write",
  moderate: "comments:moderate",
} as const;

export type CommentPermission = (typeof CommentPermissions)[keyof typeof CommentPermissions];

export const ActivityPermissions = {
  read: "activity:read",
} as const;

export type ActivityPermission = (typeof ActivityPermissions)[keyof typeof ActivityPermissions];

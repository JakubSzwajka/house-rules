export const NotificationPermissions = {
  read: "notifications:read",
  write: "notifications:write",
  deliver: "notifications:deliver",
} as const;
export type NotificationPermission =
  (typeof NotificationPermissions)[keyof typeof NotificationPermissions];

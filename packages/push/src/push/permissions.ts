export const PushPermissions = {
  read: "push:read",
  write: "push:write",
  deliver: "push:deliver",
} as const;
export type PushPermission = (typeof PushPermissions)[keyof typeof PushPermissions];

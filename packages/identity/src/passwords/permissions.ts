export const AccountPermissions = {
  update: "identity:update",
} as const;

export type AccountPermission = (typeof AccountPermissions)[keyof typeof AccountPermissions];

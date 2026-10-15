export const AccountPermissions = {
  update: "accounts:update",
} as const;

export type AccountPermission = (typeof AccountPermissions)[keyof typeof AccountPermissions];

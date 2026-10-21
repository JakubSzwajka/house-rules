export const PartyPermissions = {
  read: "party:read",
  admin: "party:admin",
  update: "party:update",
} as const;

export type PartyPermission = (typeof PartyPermissions)[keyof typeof PartyPermissions];

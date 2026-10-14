export const PartyPermissions = {
  read: "party:read",
  update: "party:update",
} as const;

export type PartyPermission = (typeof PartyPermissions)[keyof typeof PartyPermissions];

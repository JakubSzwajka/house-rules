export const builtInRoles = {
  member: {
    name: "Member",
    permissions: [
      "identity:update",
      "bookings:read",
      "bookings:write",
      "bookings:cancel",
      "billing:charge",
      "party:read",
    ],
  },
  partner: { name: "Partner", permissions: ["bookings:write"] },
  admin: {
    name: "Admin",
    permissions: [
      "identity:update",
      "party:admin",
      "party:read",
      "bookings:read",
      "bookings:write",
      "bookings:cancel",
      "billing:charge",
    ],
  },
} as const;
export const systemPermissions = [
  "identity:create",
  "identity:sign-in",
  "party:create",
  "party:admin",
  "identity:bind",
  "billing:refund",
  "billing:expire",
] as const;

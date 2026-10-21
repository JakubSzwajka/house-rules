export const builtInRoles = {
  member: {
    name: "Member",
    permissions: [
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
  "party:create",
  "party:admin",
  "identity:bind",
  "billing:refund",
  "billing:expire",
] as const;

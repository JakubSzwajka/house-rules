export const BookingPermissions = {
  read: "bookings:read",
  write: "bookings:write",
  cancel: "bookings:cancel",
} as const;

export type BookingPermission = (typeof BookingPermissions)[keyof typeof BookingPermissions];

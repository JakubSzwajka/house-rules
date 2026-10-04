export const BookingPermissions = {
  read: "bookings:read",
} as const;

export type BookingPermission = (typeof BookingPermissions)[keyof typeof BookingPermissions];

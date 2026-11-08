export const BookingPermissions = {
  make: "bookings:make",
  cancel: "bookings:cancel",
  cancelForOrg: "bookings:cancel-for-org",
  read: "bookings:read",
} as const;

export const PaymentPermissions = {
  settle: "payments:settle",
} as const;

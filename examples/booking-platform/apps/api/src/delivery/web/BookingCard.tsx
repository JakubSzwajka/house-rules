import type { Booking } from "@example/bookings";

export function BookingCard({ booking }: { booking: Booking }): string {
  return `${booking.guestName} · ${booking.id}`;
}

import * as Domain from "@alchemy.run/domain";
import { Forbidden, PartyId, partyOf, requirePermission, Session } from "@house-rules/stack";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Payment, PaymentStatus } from "./payment/payment.aggregate.ts";
import { BookingPermissions } from "./permissions.ts";
import { Booking } from "./booking/booking.aggregate.ts";
import { BookingId } from "./booking/booking.id.ts";
import { Amount } from "./booking/make-booking.command.ts";

export const BookingRow = Schema.Struct({
  bookingId: BookingId,
  guestName: Schema.String,
  orgId: Schema.NullOr(Schema.String),
  amount: Amount,
  status: Schema.Literals(["active", "cancelled"]),
  payment: Schema.NullOr(PaymentStatus),
  paymentExpiresAt: Schema.NullOr(Schema.String),
});
export type BookingRow = typeof BookingRow.Type;

export class NotYourBookings extends Domain.Rejection(
  "NotYourBookings",
  {},
  { httpApiStatus: 403 },
) {}

type State = { readonly bookings: ReadonlyArray<BookingRow> };

const update =
  (bookingId: BookingId, change: Partial<BookingRow>) =>
  (state: State): State => ({
    bookings: state.bookings.map((row) =>
      row.bookingId === bookingId ? { ...row, ...change } : row,
    ),
  });

export class MyBookings extends Domain.View("MyBookings", {
  from: [Booking, Payment],
  key: PartyId,
  middleware: [Session],
  rejects: [Forbidden, NotYourBookings],
  keyOf: {
    Booking: ({ event }) => event.owner,
    Payment: ({ event }) => event.owner,
  },
  state: Schema.Struct({ bookings: Schema.Array(BookingRow) }),
  initial: { bookings: [] },
  evolve: {
    BookingMade: (state, e, { source }) => ({
      bookings: [
        ...state.bookings,
        {
          bookingId: source.id,
          guestName: e.guestName,
          orgId: e.orgId,
          amount: e.amount,
          status: "active" as const,
          payment: null,
          paymentExpiresAt: null,
        },
      ],
    }),
    BookingCancelled: (state, _, { source }) => update(source.id, { status: "cancelled" })(state),
    PaymentOpened: (state, e, { source }) =>
      update(source.id, { payment: "pending", paymentExpiresAt: e.expiresAt })(state),
    PaymentPaid: (state, _, { source }) => update(source.id, { payment: "paid" })(state),
    PaymentExpired: (state, _, { source }) => update(source.id, { payment: "expired" })(state),
    PaymentCancelled: (state, _, { source }) => update(source.id, { payment: "cancelled" })(state),
    PaymentRefundStarted: (state, _, { source }) =>
      update(source.id, { payment: "refunding" })(state),
    PaymentRefunded: (state, _, { source }) => update(source.id, { payment: "refunded" })(state),
  },
  validate: Effect.fn(function* (request) {
    const actor = yield* requirePermission(BookingPermissions.read);
    if (request.key !== partyOf(actor)) return yield* new NotYourBookings();
  }),
}) {}

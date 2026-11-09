import * as Domain from "@alchemy.run/domain";
import {
  type Actor,
  attributionOf,
  can,
  Forbidden,
  PartyId,
  partyOf,
  requirePermission,
} from "@house-rules/stack";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BookingPermissions } from "../permissions.ts";
import { BookingId } from "./booking.id.ts";
import {
  BookingCancelled,
  CancelBooking,
  NoSuchBooking,
  NotBookingOwner,
} from "./cancel-booking.command.ts";
import {
  Amount,
  BookingExists,
  BookingMade,
  MakeBooking,
  NotOrgMember,
} from "./make-booking.command.ts";

const Booked = Schema.TaggedStruct("Booked", {
  owner: PartyId,
  orgId: Schema.NullOr(Schema.String),
  guestName: Schema.String,
  amount: Amount,
  status: Schema.Literals(["active", "cancelled"]),
});
type Booked = typeof Booked.Type;

export const BookingState = Schema.Union([Schema.TaggedStruct("Unbooked", {}), Booked]);
export type BookingState = typeof BookingState.Type;

const mayCancel = (actor: Actor, booking: Booked): boolean =>
  partyOf(actor) === booking.owner ||
  (actor._tag === "Person" &&
    booking.orgId !== null &&
    actor.orgId === booking.orgId &&
    can(actor, BookingPermissions.cancelForOrg));

export class Booking extends Domain.Aggregate("Booking", {
  id: BookingId,
  state: BookingState,
  initial: { _tag: "Unbooked" },
  commands: [MakeBooking, CancelBooking],
  decide: {
    MakeBooking: Effect.fn(function* (booking, cmd) {
      const actor = yield* requirePermission(BookingPermissions.make);
      if (booking._tag !== "Unbooked") return yield* new BookingExists();
      const orgId = cmd.orgId ?? null;
      if (orgId !== null && (actor._tag !== "Person" || actor.orgId !== orgId))
        return yield* new NotOrgMember({ orgId });
      const owner = partyOf(actor);
      if (owner === null) return yield* new Forbidden({ permission: BookingPermissions.make });
      return [
        new BookingMade({
          ...attributionOf(actor),
          owner,
          orgId,
          guestName: cmd.guestName,
          amount: cmd.amount,
        }),
      ];
    }),
    CancelBooking: Effect.fn(function* (booking, cmd) {
      const actor = yield* requirePermission(BookingPermissions.cancel);
      if (booking._tag !== "Booked") return yield* new NoSuchBooking();
      if (!mayCancel(actor, booking)) return yield* new NotBookingOwner();
      if (booking.status === "cancelled") return [];
      return [
        new BookingCancelled({
          ...attributionOf(actor),
          owner: booking.owner,
          reason: cmd.reason ?? null,
        }),
      ];
    }),
  },
  evolve: {
    BookingMade: (_, e) => ({
      _tag: "Booked" as const,
      owner: e.owner,
      orgId: e.orgId,
      guestName: e.guestName,
      amount: e.amount,
      status: "active" as const,
    }),
    BookingCancelled: (s) => (s._tag === "Booked" ? { ...s, status: "cancelled" as const } : s),
  },
}) {}

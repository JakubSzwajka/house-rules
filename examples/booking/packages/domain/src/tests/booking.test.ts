import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { CurrentActor, Forbidden, PersonId } from "@house-rules/stack";
import { describe, expect, it } from "@effect/vitest";
import {
  BookingCancelled,
  CancelBooking,
  NoSuchBooking,
  NotBookingOwner,
} from "../booking/cancel-booking.command.ts";
import {
  BookingExists,
  BookingMade,
  MakeBooking,
  NotOrgMember,
} from "../booking/make-booking.command.ts";
import { MyBookings } from "../my-bookings.view.ts";
import { BookingModel } from "../booking.model.ts";
import { PaymentCancelled, PaymentRefundStarted } from "../payment/cancel-payment.command.ts";
import { PaymentOpened } from "../payment/open-payment.command.ts";
import { PaymentProvider } from "../payment/payment-provider.external.ts";
import { PaymentPaid } from "../payment/record-charge.command.ts";
import { PaymentRefunded } from "../payment/record-refund.command.ts";
import { billing } from "../roles.ts";
import { ann, annAtAcme, b1, booking1, carol, dave, guest, payment1, story } from "./story.ts";

const annId = PersonId.make("ann");
const made = new BookingMade({
  by: "ann",
  owner: annId,
  orgId: null,
  guestName: "Grace",
  amount: 100,
});
const madeForAcme = new BookingMade({
  by: "ann",
  owner: annId,
  orgId: "acme",
  guestName: "Grace",
  amount: 100,
});
const opened = new PaymentOpened({
  owner: annId,
  amount: 100,
  expiresAt: "2026-01-02T09:00:00.000Z",
});

describe("the booking model", () => {
  it("is well defined", () => expect(Domain.verify(BookingModel)).toEqual([]));
});

describe("MakeBooking", () => {
  it.effect("books for the person, opens its payment and charges it", () =>
    story(
      Story.clock("2026-01-01T09:00:00Z"),
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100 })),
      Story.then(booking1, made),
      Story.then(payment1, opened),
      Story.call(PaymentProvider.charge, { paymentId: b1, amount: 100 }),
      Story.succeed(PaymentProvider.charge, { chargeId: "ch-1" }),
      Story.then(payment1, new PaymentPaid({ owner: annId, chargeId: "ch-1" })),
      Story.view(MyBookings, annId, {
        bookings: [
          {
            bookingId: b1,
            guestName: "Grace",
            orgId: null,
            amount: 100,
            status: "active",
            payment: "paid",
            paymentExpiresAt: "2026-01-02T09:00:00.000Z",
          },
        ],
      }),
    ),
  );

  it.effect("books for the person's own organisation", () =>
    story(
      Story.clock("2026-01-01T09:00:00Z"),
      Story.provide(CurrentActor, annAtAcme),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100, orgId: "acme" })),
      Story.then(booking1, madeForAcme),
      Story.then(payment1, opened),
      Story.call(PaymentProvider.charge, { paymentId: b1 }),
      Story.succeed(PaymentProvider.charge, { chargeId: "ch-1" }),
      Story.then(payment1, new PaymentPaid({ owner: annId, chargeId: "ch-1" })),
    ),
  );

  it.effect("refuses an organisation the person is not in", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100, orgId: "acme" })),
      Story.rejected(new NotOrgMember({ orgId: "acme" })),
    ),
  );

  it.effect("refuses a booking id that is taken", () =>
    story(
      Story.given(booking1, made),
      Story.provide(CurrentActor, carol),
      Story.when(booking1, new MakeBooking({ guestName: "Hal", amount: 50 })),
      Story.rejected(new BookingExists()),
    ),
  );

  it.effect("refuses a person without bookings:make", () =>
    story(
      Story.provide(CurrentActor, guest),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100 })),
      Story.rejected(new Forbidden({ permission: "bookings:make" })),
    ),
  );

  it.effect("refuses the billing system actor", () =>
    story(
      Story.provide(CurrentActor, billing),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100 })),
      Story.rejected(new Forbidden({ permission: "bookings:make" })),
    ),
  );
});

describe("CancelBooking", () => {
  it.effect("lets the owner cancel, refunding a paid payment", () =>
    story(
      Story.given(booking1, made),
      Story.given(payment1, opened, new PaymentPaid({ owner: annId, chargeId: "ch-1" })),
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new CancelBooking({})),
      Story.then(booking1, new BookingCancelled({ by: "ann", owner: annId, reason: null })),
      Story.then(
        payment1,
        new PaymentRefundStarted({ owner: annId, chargeId: "ch-1", amount: 100 }),
      ),
      Story.call(PaymentProvider.refund, { chargeId: "ch-1", amount: 100 }),
      Story.succeed(PaymentProvider.refund, { refundId: "re-1" }),
      Story.then(payment1, new PaymentRefunded({ owner: annId, refundId: "re-1" })),
      Story.view(MyBookings, annId, (state) => {
        expect(state.bookings[0]).toMatchObject({ status: "cancelled", payment: "refunded" });
      }),
    ),
  );

  it.effect("cancels a pending payment without calling the provider", () =>
    story(
      Story.given(booking1, made),
      Story.given(payment1, opened),
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new CancelBooking({})),
      Story.then(booking1, new BookingCancelled({ by: "ann", owner: annId, reason: null })),
      Story.then(payment1, new PaymentCancelled({ owner: annId })),
    ),
  );

  it.effect("records nothing for a booking already cancelled", () =>
    story(
      Story.given(booking1, made, new BookingCancelled({ by: "ann", owner: annId, reason: null })),
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new CancelBooking({})),
      Story.then(booking1),
    ),
  );

  it.effect("lets an org admin cancel a booking made for their organisation", () =>
    story(
      Story.given(booking1, madeForAcme),
      Story.provide(CurrentActor, dave),
      Story.when(booking1, new CancelBooking({ reason: "guest moved" })),
      Story.then(
        booking1,
        new BookingCancelled({ by: "dave", owner: annId, reason: "guest moved" }),
      ),
    ),
  );

  it.effect("refuses an org admin for a personal booking", () =>
    story(
      Story.given(booking1, made),
      Story.provide(CurrentActor, dave),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NotBookingOwner()),
    ),
  );

  it.effect("refuses another member", () =>
    story(
      Story.given(booking1, made),
      Story.provide(CurrentActor, carol),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NotBookingOwner()),
    ),
  );

  it.effect("refuses an unknown booking", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NoSuchBooking()),
    ),
  );

  it.effect("refuses a person without bookings:cancel", () =>
    story(
      Story.given(booking1, made),
      Story.provide(CurrentActor, guest),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new Forbidden({ permission: "bookings:cancel" })),
    ),
  );
});

describe("MyBookings", () => {
  it.effect("shows only the person's own bookings", () =>
    story(
      Story.given(booking1, made),
      Story.view(MyBookings, annId, (state) => expect(state.bookings).toHaveLength(1)),
      Story.view(MyBookings, PersonId.make("carol"), Story.none),
    ),
  );
});

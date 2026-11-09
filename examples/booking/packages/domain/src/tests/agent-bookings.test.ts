import { Story } from "@alchemy.run/domain/Story";
import { AgentId, CurrentActor, Forbidden, PersonId, system } from "@house-rules/stack";
import { describe, expect, it } from "@effect/vitest";
import {
  BookingCancelled,
  CancelBooking,
  NotBookingOwner,
} from "../booking/cancel-booking.command.ts";
import { BookingMade, MakeBooking, NotOrgMember } from "../booking/make-booking.command.ts";
import { MyBookings } from "../my-bookings.view.ts";
import { PaymentRefundStarted } from "../payment/cancel-payment.command.ts";
import { PaymentOpened } from "../payment/open-payment.command.ts";
import { PaymentProvider } from "../payment/payment-provider.external.ts";
import { PaymentPaid } from "../payment/record-charge.command.ts";
import { PaymentRefunded } from "../payment/record-refund.command.ts";
import { ann, b1, booking1, claude, otherAgent, payment1, story } from "./story.ts";

const annId = PersonId.make("ann");
const made = new BookingMade({
  by: "ann",
  owner: annId,
  orgId: null,
  guestName: "Grace",
  amount: 100,
});
const opened = new PaymentOpened({
  owner: annId,
  amount: 100,
  expiresAt: "2026-01-02T09:00:00.000Z",
});
const claudeId = AgentId.make("agent:claude");
const madeByClaude = new BookingMade({
  by: "agent:claude",
  for: annId,
  owner: claudeId,
  orgId: null,
  guestName: "Grace",
  amount: 100,
});

describe("an agent as a booking party", () => {
  it.effect("refuses a system actor even with bookings:make, since it is no party", () =>
    story(
      Story.provide(CurrentActor, system("importer", ["bookings:make"])),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100 })),
      Story.rejected(new Forbidden({ permission: "bookings:make" })),
    ),
  );

  it.effect("refuses an agent an organisation booking, since it is no member", () =>
    story(
      Story.provide(CurrentActor, claude),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100, orgId: "acme" })),
      Story.rejected(new NotOrgMember({ orgId: "acme" })),
    ),
  );

  it.effect("lets an agent make and cancel its own booking, recorded for its person", () =>
    story(
      Story.clock("2026-01-01T09:00:00Z"),
      Story.provide(CurrentActor, claude),
      Story.when(booking1, new MakeBooking({ guestName: "Grace", amount: 100 })),
      Story.then(booking1, madeByClaude),
      Story.then(payment1, new PaymentOpened({ ...opened, owner: claudeId })),
      Story.call(PaymentProvider.charge, { paymentId: b1, amount: 100 }),
      Story.succeed(PaymentProvider.charge, { chargeId: "ch-1" }),
      Story.then(payment1, new PaymentPaid({ owner: claudeId, chargeId: "ch-1" })),
      Story.when(booking1, new CancelBooking({})),
      Story.then(
        booking1,
        new BookingCancelled({ by: "agent:claude", for: annId, owner: claudeId, reason: null }),
      ),
      Story.then(
        payment1,
        new PaymentRefundStarted({ owner: claudeId, chargeId: "ch-1", amount: 100 }),
      ),
      Story.call(PaymentProvider.refund, { chargeId: "ch-1", amount: 100 }),
      Story.succeed(PaymentProvider.refund, { refundId: "re-1" }),
      Story.then(payment1, new PaymentRefunded({ owner: claudeId, refundId: "re-1" })),
      Story.view(MyBookings, claudeId, (state) => {
        expect(state.bookings[0]).toMatchObject({ status: "cancelled", payment: "refunded" });
      }),
      Story.view(MyBookings, annId, Story.none),
    ),
  );

  it.effect("refuses an agent that does not own the booking, even its person's", () =>
    story(
      Story.given(booking1, made),
      Story.provide(CurrentActor, claude),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NotBookingOwner()),
    ),
  );

  it.effect("refuses another agent its sibling agent's booking, and the person too", () =>
    story(
      Story.given(booking1, madeByClaude),
      Story.provide(CurrentActor, otherAgent),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NotBookingOwner()),
      Story.provide(CurrentActor, ann),
      Story.when(booking1, new CancelBooking({})),
      Story.rejected(new NotBookingOwner()),
    ),
  );
});

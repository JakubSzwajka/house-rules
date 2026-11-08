import { Story } from "@alchemy.run/domain/Story";
import { CurrentActor, Forbidden, PersonId } from "@house-rules/stack";
import { describe, expect, it } from "@effect/vitest";
import { BookingMade } from "../booking/make-booking.command.ts";
import { MyBookings } from "../my-bookings.view.ts";
import { CancelPayment } from "../payment/cancel-payment.command.ts";
import { PaymentExpired } from "../payment/expire-payment.command.ts";
import { OpenPayment, PaymentOpened } from "../payment/open-payment.command.ts";
import { ChargeDeclined, PaymentProvider } from "../payment/payment-provider.external.ts";
import { PaymentPaid, RecordCharge } from "../payment/record-charge.command.ts";
import { RecordRefund } from "../payment/record-refund.command.ts";
import { billing } from "../roles.ts";
import { ann, b1, booking1, payment1, story } from "./story.ts";

const annId = PersonId.make("ann");
const opened = new PaymentOpened({
  owner: annId,
  amount: 100,
  expiresAt: "2026-01-02T09:00:00.000Z",
});

describe("OpenPayment", () => {
  it.effect("opens a pending payment that expires when its charge is declined", () =>
    story(
      Story.given(
        booking1,
        new BookingMade({ by: "ann", owner: annId, orgId: null, guestName: "Grace", amount: 100 }),
      ),
      Story.clock("2026-01-01T09:00:00Z"),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new OpenPayment({ owner: annId, amount: 100 })),
      Story.then(payment1, opened),
      Story.call(PaymentProvider.charge, { paymentId: b1, amount: 100 }),
      Story.fail(PaymentProvider.charge, new ChargeDeclined({ reason: "insufficient funds" })),
      Story.then(payment1),
      Story.advance("23 hours"),
      Story.then(payment1),
      Story.advance("1 hour"),
      Story.then(payment1, new PaymentExpired({ owner: annId })),
      Story.view(MyBookings, annId, (state) => {
        expect(state.bookings[0]?.payment).toBe("expired");
      }),
    ),
  );

  it.effect("does not expire a payment that was paid in time", () =>
    story(
      Story.clock("2026-01-01T09:00:00Z"),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new OpenPayment({ owner: annId, amount: 100 })),
      Story.then(payment1, opened),
      Story.call(PaymentProvider.charge, { paymentId: b1 }),
      Story.succeed(PaymentProvider.charge, { chargeId: "ch-1" }),
      Story.then(payment1, new PaymentPaid({ owner: annId, chargeId: "ch-1" })),
      Story.advance("2 days"),
      Story.then(payment1),
      Story.state(payment1, { _tag: "Opened", status: "paid" }),
    ),
  );

  it.effect("opens a payment once", () =>
    story(
      Story.given(payment1, opened),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new OpenPayment({ owner: annId, amount: 100 })),
      Story.then(payment1),
    ),
  );

  it.effect("refuses a person without payments:settle", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(payment1, new OpenPayment({ owner: annId, amount: 1 })),
      Story.rejected(new Forbidden({ permission: "payments:settle" })),
    ),
  );
});

describe("settling commands", () => {
  it.effect("ignore a charge for a payment that is no longer pending", () =>
    story(
      Story.given(payment1, opened, new PaymentExpired({ owner: annId })),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new RecordCharge({ chargeId: "ch-late" })),
      Story.then(payment1),
    ),
  );

  it.effect("ignore a refund for a payment that is not refunding", () =>
    story(
      Story.given(payment1, opened),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new RecordRefund({ refundId: "re-1" })),
      Story.then(payment1),
    ),
  );

  it.effect("ignore cancelling a payment that expired", () =>
    story(
      Story.given(payment1, opened, new PaymentExpired({ owner: annId })),
      Story.provide(CurrentActor, billing),
      Story.when(payment1, new CancelPayment()),
      Story.then(payment1),
    ),
  );

  it.effect("are refused to people", () =>
    story(
      Story.given(payment1, opened),
      Story.provide(CurrentActor, ann),
      Story.when(payment1, new RecordCharge({ chargeId: "ch-1" })),
      Story.rejected(new Forbidden({ permission: "payments:settle" })),
      Story.when(payment1, new CancelPayment()),
      Story.rejected(new Forbidden({ permission: "payments:settle" })),
      Story.when(payment1, new RecordRefund({ refundId: "re-1" })),
      Story.rejected(new Forbidden({ permission: "payments:settle" })),
    ),
  );
});

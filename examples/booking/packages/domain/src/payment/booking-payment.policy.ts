import * as Domain from "@alchemy.run/domain";
import { CurrentActor } from "@house-rules/stack";
import * as Effect from "effect/Effect";
import { Booking } from "../booking/booking.aggregate.ts";
import { BookingCancelled } from "../booking/cancel-booking.command.ts";
import { BookingMade } from "../booking/make-booking.command.ts";
import { billing } from "../roles.ts";
import { CancelPayment } from "./cancel-payment.command.ts";
import { OpenPayment } from "./open-payment.command.ts";
import { Payment } from "./payment.aggregate.ts";

export class BookingPayment extends Domain.Policy("BookingPayment", {
  from: Booking,
  on: [BookingMade, BookingCancelled],
}) {}

export const BookingPaymentLive = BookingPayment.toLayer(
  Effect.gen(function* () {
    const payments = yield* Payment;
    return Effect.fn(function* ({ source, event }) {
      const command =
        event._tag === "BookingMade"
          ? new OpenPayment({ owner: event.owner, amount: event.amount })
          : new CancelPayment();
      yield* payments
        .send(source.id, command)
        .pipe(Effect.orDie, Effect.provideService(CurrentActor, billing));
    });
  }),
);

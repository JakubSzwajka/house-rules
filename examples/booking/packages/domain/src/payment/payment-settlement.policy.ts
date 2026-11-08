import * as Domain from "@alchemy.run/domain";
import { CurrentActor } from "@house-rules/stack";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { BookingId } from "../booking/booking.id.ts";
import { billing } from "../roles.ts";
import { PaymentRefundStarted } from "./cancel-payment.command.ts";
import { ExpirePayment } from "./expire-payment.command.ts";
import { PaymentOpened } from "./open-payment.command.ts";
import { Payment } from "./payment.aggregate.ts";
import { PaymentProvider } from "./payment-provider.external.ts";
import { RecordCharge } from "./record-charge.command.ts";
import { RecordRefund } from "./record-refund.command.ts";

export class PaymentSettlement extends Domain.Policy("PaymentSettlement", {
  from: Payment,
  on: [PaymentOpened, PaymentRefundStarted],
}) {}

export const PaymentSettlementLive = PaymentSettlement.toLayer(
  Effect.gen(function* () {
    const payments = yield* Payment;
    const provider = yield* PaymentProvider;
    const charge = Effect.fn(function* (id: BookingId, event: PaymentOpened) {
      yield* payments.schedule(id, new ExpirePayment(), {
        at: DateTime.makeUnsafe(event.expiresAt),
        commandId: "expire",
      });
      const charged = yield* provider.charge({ paymentId: id, amount: event.amount });
      yield* payments.send(id, new RecordCharge({ chargeId: charged.chargeId }));
    });
    const refund = Effect.fn(function* (id: BookingId, event: PaymentRefundStarted) {
      const refunded = yield* provider.refund({ chargeId: event.chargeId, amount: event.amount });
      yield* payments.send(id, new RecordRefund({ refundId: refunded.refundId }));
    });
    return Effect.fn(function* ({ source, event }) {
      const reaction =
        event._tag === "PaymentOpened" ? charge(source.id, event) : refund(source.id, event);
      yield* reaction.pipe(
        Effect.catchTags({
          ChargeDeclined: (declined) =>
            Effect.logWarning(`charge declined for ${source.id}: ${declined.reason}`),
          AlreadyExecuted: () => Effect.void,
        }),
        Effect.orDie,
        Effect.provideService(CurrentActor, billing),
      );
    });
  }),
);

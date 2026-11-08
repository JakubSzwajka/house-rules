import { ChargeDeclined, PaymentProvider } from "@example/booking-domain";
import * as Effect from "effect/Effect";

export const CARD_LIMIT = 1_000;

export const FakePaymentProvider = PaymentProvider.toLayer(
  Effect.succeed({
    charge: ({ paymentId, amount }) =>
      amount > CARD_LIMIT
        ? Effect.fail(new ChargeDeclined({ reason: `over the demo card limit of ${CARD_LIMIT}` }))
        : Effect.succeed({ chargeId: `ch_${paymentId}` }),
    refund: ({ chargeId }) => Effect.succeed({ refundId: `re_${chargeId}` }),
  }),
);

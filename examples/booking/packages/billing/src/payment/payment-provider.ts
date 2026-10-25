import { Context, type Effect } from "effect";
import type { ChargeStatus, Payment, PaymentProviderFailed } from "./payment.ts";

export class PaymentProvider extends Context.Service<
  PaymentProvider,
  {
    readonly charge: (payment: Payment) => Effect.Effect<ChargeStatus, PaymentProviderFailed>;
    readonly refund: (payment: Payment) => Effect.Effect<void, PaymentProviderFailed>;
  }
>()("@example/api/modules/billing/PaymentProvider") {}

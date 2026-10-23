import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Payment, PaymentStatus, PaymentStoreUnavailable } from "./payment/payment.ts";

export class PaymentStore extends Context.Service<
  PaymentStore,
  {
    readonly find: (id: string) => Effect.Effect<Payment | undefined, PaymentStoreUnavailable>;
    readonly findByBookingId: (
      bookingId: string,
    ) => Effect.Effect<Payment | undefined, PaymentStoreUnavailable>;
    readonly insert: (
      payment: Payment,
    ) => Effect.Effect<boolean, PaymentStoreUnavailable | NoOpenUnit>;
    readonly transition: (
      id: string,
      from: PaymentStatus,
      to: PaymentStatus,
    ) => Effect.Effect<boolean, PaymentStoreUnavailable | NoOpenUnit>;
    readonly dueBefore: (
      cutoff: number,
    ) => Effect.Effect<readonly { readonly paymentId: string }[], PaymentStoreUnavailable>;
    readonly expireOne: (
      id: string,
      cutoff: number,
    ) => Effect.Effect<boolean, PaymentStoreUnavailable | NoOpenUnit>;
  }
>()("@example/api/modules/billing/PaymentStore") {}

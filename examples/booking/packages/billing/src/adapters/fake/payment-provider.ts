import { Effect, Layer } from "effect";
import { PaymentProvider } from "../../payment/payment-provider.ts";
import { type ChargeStatus, type Payment, PaymentProviderFailed } from "../../payment/payment.ts";

export type ProviderCall = Readonly<{ operation: "charge" | "refund"; payment: Payment }>;
export type FakePaymentProviderOptions = Readonly<{
  chargeStatus?: ChargeStatus;
  failCharge?: boolean;
  failRefund?: boolean;
}>;
export const makeFakePaymentProvider = (options: FakePaymentProviderOptions = {}) => {
  const recorded: ProviderCall[] = [];
  let chargeStatus: ChargeStatus = options.chargeStatus ?? "paid";
  const failures = { charge: options.failCharge ?? false, refund: options.failRefund ?? false };
  const record = (operation: "charge" | "refund", payment: Payment) =>
    Effect.sync(() => {
      recorded.push({ operation, payment: { ...payment } });
    });
  const service = PaymentProvider.of({
    charge: Effect.fn("PaymentProvider.fake.charge")(function* (payment: Payment) {
      yield* record("charge", payment);
      if (failures.charge) return yield* new PaymentProviderFailed({ operation: "charge" });
      return chargeStatus;
    }),
    refund: Effect.fn("PaymentProvider.fake.refund")(function* (payment: Payment) {
      yield* record("refund", payment);
      if (failures.refund) return yield* new PaymentProviderFailed({ operation: "refund" });
    }),
  });
  return {
    layer: Layer.succeed(PaymentProvider, service),
    calls: Effect.sync((): readonly ProviderCall[] =>
      recorded.map((call) => ({ ...call, payment: { ...call.payment } })),
    ),
    setFailure: (operation: "charge" | "refund", fail: boolean) =>
      Effect.sync(() => {
        failures[operation] = fail;
      }),
    setChargeStatus: (status: ChargeStatus) =>
      Effect.sync(() => {
        chargeStatus = status;
      }),
  };
};
export const fakePaymentProvider = (options: FakePaymentProviderOptions = {}) =>
  makeFakePaymentProvider(options).layer;

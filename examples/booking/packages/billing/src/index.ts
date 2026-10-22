import { Billing } from "./facade.ts";
import { BillingOperations } from "./payment/operations.ts";
import { bindBilling } from "./payment/bind-billing.ts";
import type { MountDefinition } from "@house-rules/application";
export const BillingMount = {
  service: Billing,
  operations: Object.values(BillingOperations),
  bind: bindBilling,
} satisfies MountDefinition<Billing, Billing["Service"]>;
export { Billing };
export { bindBilling } from "./payment/bind-billing.ts";
export { BillingOperations } from "./payment/operations.ts";
export {
  Payment,
  PaymentStatus,
  ChargeStatus,
  NewPayment,
  RefundInput,
  ExpiredPayments,
  PaymentNotFound,
  PaymentAlreadyExists,
  PaymentRefundDenied,
  PaymentNotPaid,
  PaymentCallerDenied,
  PaymentStoreUnavailable,
  PaymentProviderFailed,
} from "./payment/payment.ts";
export {
  BillingPermissions,
  paymentPolicy,
  paymentRelation,
  pendingLifetimeMillis,
} from "./payment/payment-policy.ts";
export { PaymentProvider } from "./payment/payment-provider.ts";
export { PaymentStore } from "./storage.ts";
export { memoryPaymentStore } from "./adapters/memory/payment.ts";
export { postgresPaymentStore } from "./adapters/postgres/payment.ts";
export {
  fakePaymentProvider,
  makeFakePaymentProvider,
  type ProviderCall,
  type FakePaymentProviderOptions,
} from "./adapters/fake/payment-provider.ts";

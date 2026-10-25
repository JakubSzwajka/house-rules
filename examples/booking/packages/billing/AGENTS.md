# Billing

Billing owns payments, payment_read and its existing migrations. Mount BillingMount with Billing.layer and choose PaymentStore/PaymentProvider only in the app's composition/modules.ts. Memory and Postgres adapters share the store suite. No migration changes are needed for scheduled expiry.

## Scheduled expiry

BillingOperations.duePayments is a read-only, system-only selector. It returns `{ paymentId }[]` for pending payments strictly older than 24 hours, ordered by id. It needs no unit. BillingOperations.expireOne takes `{ paymentId }` and returns `{ expired: 0 | 1 }`. It requires a system caller and an open unit. The store conditionally changes only that pending, due row, so missing, fresh, paid, refunded or already-expired payments are no-ops. Running it twice is safe.

The app's due_payments and expire_payment system features expose these operations to a schedule way. The UTC clock 0 3 * * * first waits for the next tick. Each item runs sequentially in its own feature unit. A failed item rolls back without undoing earlier items, and later items continue. There is no distributed lease, so idempotency is required. Never restore a whole-batch expiry write or open a unit inside Billing.

## Proof

Run `pnpm --filter @example/billing test`. The shared memory/Postgres suite covers due selection, strict cutoff, conditional transitions, rollback and repeated expiry. Facade tests use TestClock to cover the 24-hour boundary and idempotency. Application system-way tests cover tick timing, per-item rollback and disposal.

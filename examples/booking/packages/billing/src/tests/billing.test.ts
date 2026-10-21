import { expect, it } from "@effect/vitest";
import { type Caller } from "@house-rules/domain";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  Billing,
  makeFakePaymentProvider,
  memoryPaymentStore,
  PaymentStore,
  pendingLifetimeMillis,
  paymentPolicy,
  BillingPermissions,
} from "../index.ts";

const owner = Actor.make({ id: ActorId.make("clock-owner") });
const system: Caller = {
  kind: "system",
  reason: "nightly cleanup",
  startedBy: "schedule:nightly_cleanup",
};

it.effect(
  "reads Effect Clock on each call and expires only pending payments older than 24 hours",
  () => {
    const fake = makeFakePaymentProvider({ chargeStatus: "pending" });
    const ports = Layer.merge(memoryPaymentStore(), fake.layer);
    return Effect.gen(function* () {
      const billing = yield* Billing;
      const store = yield* PaymentStore;
      yield* TestClock.setTime(0);
      const old = yield* UnitOfWork.atomic(
        billing.initPayment(owner, { id: "old", bookingId: "booking-old", amount: 100 }),
      );
      const paid = yield* UnitOfWork.atomic(
        billing.initPayment(owner, { id: "paid", bookingId: "booking-paid", amount: 100 }),
      );
      yield* UnitOfWork.atomic(store.transition(paid.id, "pending", "paid"));
      expect(old.createdAt).toBe(0);
      yield* TestClock.adjust("24 hours");
      const boundary = yield* UnitOfWork.atomic(billing.expirePending(system));
      expect(boundary).toEqual({ expired: 0 });
      const fresh = yield* UnitOfWork.atomic(
        billing.initPayment(owner, { id: "fresh", bookingId: "booking-fresh", amount: 100 }),
      );
      expect(fresh.createdAt).toBe(pendingLifetimeMillis);
      yield* TestClock.adjust(1);
      expect(yield* Clock.currentTimeMillis).toBe(pendingLifetimeMillis + 1);
      expect(yield* UnitOfWork.atomic(billing.expirePending(system))).toEqual({ expired: 1 });
      expect((yield* store.find(old.id))?.status).toBe("expired");
      expect((yield* store.find(paid.id))?.status).toBe("paid");
      expect((yield* store.find(fresh.id))?.status).toBe("pending");
      expect(yield* UnitOfWork.atomic(billing.expirePending(system))).toEqual({ expired: 0 });
      expect(yield* fake.calls).toHaveLength(3);
    }).pipe(
      Effect.provide(Layer.merge(Billing.layer.pipe(Layer.provideMerge(ports)), memoryUnitOfWork)),
    );
  },
);

it.effect("refund policy permits only system and paid together", () =>
  Effect.sync(() => {
    for (const relation of ["person", "system"] as const) {
      for (const status of ["pending", "paid", "refunded", "expired"] as const) {
        expect(paymentPolicy.allows(relation, status, BillingPermissions.refund)).toBe(
          relation === "system" && status === "paid",
        );
      }
    }
  }),
);

it.effect("fake provider controls and call snapshots do not run network requests", () => {
  const fake = makeFakePaymentProvider();
  return Effect.gen(function* () {
    const billing = yield* Billing;
    const paid = yield* UnitOfWork.atomic(
      billing.initPayment(owner, { id: "paid", bookingId: "paid", amount: 100 }),
    );
    expect(paid.status).toBe("paid");
    yield* fake.setChargeStatus("pending");
    const pending = yield* UnitOfWork.atomic(
      billing.initPayment(owner, { id: "pending", bookingId: "pending", amount: 100 }),
    );
    expect(pending.status).toBe("pending");
    const snapshot = yield* fake.calls;
    yield* UnitOfWork.atomic(billing.refund(system, paid.bookingId));
    expect(snapshot).toHaveLength(2);
    expect(yield* fake.calls).toHaveLength(3);
    expect(snapshot[0]?.payment.status).toBe("pending");
  }).pipe(
    Effect.provide(
      Layer.merge(
        Billing.layer.pipe(Layer.provide(Layer.merge(memoryPaymentStore(), fake.layer))),
        memoryUnitOfWork,
      ),
    ),
  );
});

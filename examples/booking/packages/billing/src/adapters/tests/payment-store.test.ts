import { expect, layer } from "@effect/vitest";
import { type Caller } from "@house-rules/domain";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  Billing,
  makeFakePaymentProvider,
  Payment,
  PaymentStore,
  PaymentAlreadyExists,
  PaymentNotFound,
  PaymentNotPaid,
  PaymentRefundDenied,
  PaymentCallerDenied,
  PaymentProviderFailed,
} from "../../index.ts";
import { stores } from "./stores.ts";

class AbortPayment extends Schema.TaggedError<AbortPayment>()("AbortPayment", {}) {}
const owner = Actor.make({ id: ActorId.make("owner-a") });
const person: Caller = { kind: "person", actor: owner, via: "test" };
const system: Caller = { kind: "system", reason: "refund after cancel", startedBy: "test" };
const row = (id: string, status: Payment["status"] = "pending", createdAt = 100): Payment => ({
  id,
  bookingId: `booking-${id}`,
  amount: 2500,
  ownerId: owner.id,
  status,
  createdAt,
});
const input = (id: string) => ({ id, bookingId: `booking-${id}`, amount: 2500 });

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `v2 PaymentStore on ${name}`,
    (it) => {
      it.effect("finds by id and booking id, including absent rows", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          expect(yield* store.find("absent")).toBeUndefined();
          expect(yield* store.findByBookingId("absent")).toBeUndefined();
          yield* UnitOfWork.atomic(store.insert(row("lookup")));
          expect(yield* store.find("lookup")).toEqual(row("lookup"));
          expect(yield* store.findByBookingId("booking-lookup")).toEqual(row("lookup"));
        }),
      );
      it.effect("rejects every write outside a unit without changing data", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          expect(yield* Effect.flip(store.insert(row("no-unit")))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(store.transition("absent", "pending", "paid"))).toBeInstanceOf(
            NoOpenUnit,
          );
          expect(yield* Effect.flip(store.expireOne("absent", 1000))).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find("no-unit")).toBeUndefined();
        }),
      );
      it.effect("commits and rejects duplicate id or booking id without replacement", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          expect(yield* UnitOfWork.atomic(store.insert(row("unique")))).toBe(true);
          expect(
            yield* UnitOfWork.atomic(
              store.insert({ ...row("unique"), bookingId: "other-booking", ownerId: "other" }),
            ),
          ).toBe(false);
          expect(
            yield* UnitOfWork.atomic(
              store.insert({ ...row("other-id"), bookingId: "booking-unique" }),
            ),
          ).toBe(false);
          expect(yield* store.find("unique")).toEqual(row("unique"));
          expect(yield* store.find("other-id")).toBeUndefined();
        }),
      );
      it.effect("rolls back inserted rows and restores status transitions", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          yield* UnitOfWork.atomic(store.insert(row("retained")));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.insert(row("rolled-back-a"));
                  yield* store.insert(row("rolled-back-b"));
                  yield* store.transition("retained", "pending", "paid");
                  yield* store.transition("retained", "paid", "refunded");
                  return yield* new AbortPayment();
                }),
              ),
            ),
          ).toBeInstanceOf(AbortPayment);
          expect(yield* store.find("rolled-back-a")).toBeUndefined();
          expect(yield* store.find("rolled-back-b")).toBeUndefined();
          expect(yield* store.find("retained")).toEqual(row("retained"));
        }),
      );
      it.effect("compares the old status on transitions", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          yield* UnitOfWork.atomic(store.insert(row("moving")));
          expect(yield* UnitOfWork.atomic(store.transition("absent", "pending", "paid"))).toBe(
            false,
          );
          expect(yield* UnitOfWork.atomic(store.transition("moving", "paid", "refunded"))).toBe(
            false,
          );
          expect(yield* UnitOfWork.atomic(store.transition("moving", "pending", "paid"))).toBe(
            true,
          );
          expect(yield* UnitOfWork.atomic(store.transition("moving", "pending", "paid"))).toBe(
            false,
          );
          expect(yield* store.find("moving")).toEqual(row("moving", "paid"));
        }),
      );
      it.effect("expires only pending rows strictly before the cutoff and rolls back expiry", () =>
        Effect.gen(function* () {
          const store = yield* PaymentStore;
          const seeds = [
            row("expiry-old", "pending", 0),
            row("expiry-boundary", "pending", 1),
            row("expiry-new", "pending", 2),
            row("expiry-paid", "paid", 0),
            row("expiry-refunded", "refunded", 0),
            row("expiry-expired", "expired", 0),
          ];
          yield* UnitOfWork.atomic(Effect.forEach(seeds, (payment) => store.insert(payment)));
          expect(yield* store.dueBefore(1)).toEqual([{ paymentId: "expiry-old" }]);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                store.expireOne("expiry-old", 1).pipe(Effect.andThen(new AbortPayment())),
              ),
            ),
          ).toBeInstanceOf(AbortPayment);
          expect(yield* store.find("expiry-old")).toEqual(seeds[0]);
          expect(yield* UnitOfWork.atomic(store.expireOne("expiry-old", 1))).toBe(true);
          expect((yield* store.find("expiry-old"))?.status).toBe("expired");
          for (const payment of seeds.slice(1))
            expect(yield* store.find(payment.id)).toEqual(payment);
          expect(yield* UnitOfWork.atomic(store.expireOne("expiry-old", 1))).toBe(false);
          expect(yield* store.dueBefore(1)).toEqual([]);
          for (const payment of seeds.slice(1))
            expect(yield* UnitOfWork.atomic(store.expireOne(payment.id, 1))).toBe(false);
        }),
      );
      it.effect("service charges once, returns paid and keeps the caller's owner fact", () => {
        const fake = makeFakePaymentProvider();
        return Effect.gen(function* () {
          const billing = yield* Billing;
          const before = yield* Clock.currentTimeMillis;
          const payment = yield* UnitOfWork.atomic(billing.initPayment(owner, input("charge")));
          expect(payment).toMatchObject({ ...input("charge"), ownerId: owner.id, status: "paid" });
          expect(payment.createdAt).toBeGreaterThanOrEqual(before);
          expect(yield* (yield* PaymentStore).find("charge")).toEqual(payment);
          expect(yield* fake.calls).toEqual([
            { operation: "charge", payment: { ...payment, status: "pending" } },
          ]);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.initPayment(owner, input("charge")))),
          ).toBeInstanceOf(PaymentAlreadyExists);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                billing.initPayment(owner, {
                  ...input("different-id"),
                  bookingId: payment.bookingId,
                }),
              ),
            ),
          ).toBeInstanceOf(PaymentAlreadyExists);
          expect(yield* fake.calls).toHaveLength(1);
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
      it.effect("service rolls back an inserted payment when the fake charge fails", () => {
        const fake = makeFakePaymentProvider({ failCharge: true });
        return Effect.gen(function* () {
          const billing = yield* Billing;
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(billing.initPayment(owner, input("charge-fails"))),
            ),
          ).toEqual(new PaymentProviderFailed({ operation: "charge" }));
          const store = yield* PaymentStore;
          expect(yield* store.find("charge-fails")).toBeUndefined();
          expect(yield* store.findByBookingId("booking-charge-fails")).toBeUndefined();
          expect(yield* fake.calls).toHaveLength(1);
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
      it.effect("service can leave a charge pending", () => {
        const fake = makeFakePaymentProvider({ chargeStatus: "pending" });
        return Effect.gen(function* () {
          const billing = yield* Billing;
          const payment = yield* UnitOfWork.atomic(
            billing.initPayment(owner, input("charge-pending")),
          );
          expect(payment.status).toBe("pending");
          expect(yield* (yield* PaymentStore).find(payment.id)).toEqual(payment);
          expect(yield* fake.calls).toHaveLength(1);
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
      it.effect("service allows only the system to refund a paid payment", () => {
        const fake = makeFakePaymentProvider();
        return Effect.gen(function* () {
          const billing = yield* Billing;
          const store = yield* PaymentStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(["pending", "paid", "refunded", "expired"] as const, (status) =>
              store.insert(row(`policy-${status}`, status)),
            ),
          );
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.refund(person, "booking-policy-paid"))),
          ).toEqual(new PaymentRefundDenied({ bookingId: "booking-policy-paid" }));
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.refund(person, "absent"))),
          ).toBeInstanceOf(PaymentRefundDenied);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.refund(system, "absent"))),
          ).toBeInstanceOf(PaymentNotFound);
          for (const status of ["pending", "refunded", "expired"]) {
            expect(
              yield* Effect.flip(
                UnitOfWork.atomic(billing.refund(system, `booking-policy-${status}`)),
              ),
            ).toBeInstanceOf(PaymentNotPaid);
          }
          expect(yield* fake.calls).toEqual([]);
          const refunded = yield* UnitOfWork.atomic(billing.refund(system, "booking-policy-paid"));
          expect(refunded.status).toBe("refunded");
          expect(yield* store.find("policy-paid")).toEqual(refunded);
          expect(yield* fake.calls).toEqual([
            { operation: "refund", payment: row("policy-paid", "paid") },
          ]);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.refund(system, "booking-policy-paid"))),
          ).toBeInstanceOf(PaymentNotPaid);
          expect(yield* fake.calls).toHaveLength(1);
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
      it.effect("a failing refund restores the paid row", () => {
        const fake = makeFakePaymentProvider({ failRefund: true });
        return Effect.gen(function* () {
          const billing = yield* Billing;
          const store = yield* PaymentStore;
          yield* UnitOfWork.atomic(store.insert(row("refund-fails", "paid")));
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.refund(system, "booking-refund-fails"))),
          ).toEqual(new PaymentProviderFailed({ operation: "refund" }));
          expect(yield* store.find("refund-fails")).toEqual(row("refund-fails", "paid"));
          expect(yield* fake.calls).toHaveLength(1);
          yield* fake.setFailure("refund", false);
          expect(
            (yield* UnitOfWork.atomic(billing.refund(system, "booking-refund-fails"))).status,
          ).toBe("refunded");
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
      it.effect("service requires a unit before provider calls, and denies person expiry", () => {
        const fake = makeFakePaymentProvider();
        return Effect.gen(function* () {
          const billing = yield* Billing;
          expect(
            yield* Effect.flip(billing.initPayment(owner, input("service-no-unit"))),
          ).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(billing.refund(system, "absent"))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(billing.expireOne(system, "absent"))).toBeInstanceOf(
            NoOpenUnit,
          );
          expect(
            yield* Effect.flip(UnitOfWork.atomic(billing.expireOne(person, "absent"))),
          ).toBeInstanceOf(PaymentCallerDenied);
          expect(yield* fake.calls).toEqual([]);
          expect(yield* (yield* PaymentStore).find("service-no-unit")).toBeUndefined();
        }).pipe(Effect.provide(Billing.layer.pipe(Layer.provide(fake.layer))));
      });
    },
  );
}
layer(stores[1].layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "v2 payment view",
  (it) => {
    it.effect("publishes the owned payment view with a plain booking reference", () =>
      Effect.gen(function* () {
        const store = yield* PaymentStore;
        const sql = yield* SqlClient;
        yield* UnitOfWork.atomic(store.insert(row("published", "paid")));
        const published = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: Payment,
          execute: () =>
            sql`select id, booking_id as "bookingId", owner_id as "ownerId", amount, status, created_at::double precision as "createdAt" from payment_read where id = 'published'`,
        })();
        expect(published).toEqual([row("published", "paid")]);
      }),
    );
  },
);

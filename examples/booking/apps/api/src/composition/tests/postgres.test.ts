import { runFeature } from "@house-rules/application";
import { assert, it } from "@effect/vitest";
import { Features, memberPermissions, systemPermissions } from "../../features/index.ts";
import { Billing, makeFakePaymentProvider } from "@example/billing";
import { Bookings } from "@example/bookings";
import { MyStuff } from "../../read-models/my-bookings/index.ts";
import { May, StepTrace } from "@house-rules/application";
import { Approval, CurrentActor, withRequestId } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { CallAudit } from "@house-rules/call-audit";
import { Context, Effect, Layer } from "effect";
import { modulesLayer, plugSockets } from "../index.ts";
import { databaseTesting } from "./database.ts";

it.effect(
  "real PG refund failure rolls back cancel across modules and produces one failed entry record",
  () =>
    Effect.gen(function* () {
      const provider = makeFakePaymentProvider();
      const database = yield* Layer.build(databaseTesting);
      const ctx = yield* Layer.build(
        plugSockets(
          modulesLayer({ provider: provider.layer }).pipe(
            Layer.provide(Layer.succeedContext(database)),
          ),
        ),
      );
      const alice = Actor.make({ id: ActorId.make("alice") });
      const trace = Context.get(ctx, StepTrace);
      const request = Context.merge(
        ctx,
        May.context(May.fixed(Object.values(Features), memberPermissions), {
          system: systemPermissions,
          via: "test",
        }),
      ).pipe(Context.add(CurrentActor, alice));
      const refused = yield* runFeature(Features.makeBooking, {
        id: "refused",
        guestName: "Alice",
        paymentId: "no-pay",
        amount: 42,
      }).pipe(
        withRequestId("refused-charge"),
        Effect.provideContext(
          Context.merge(
            request,
            May.context(May.fixed(Object.values(Features), ["bookings:write"]), {
              system: systemPermissions,
              via: "test",
            }),
          ),
        ),
        Effect.provide(Approval.allowAll),
        Effect.flip,
      );
      assert.strictEqual(refused._tag, "Forbidden");
      assert.deepStrictEqual(yield* provider.calls, []);
      assert.deepStrictEqual((yield* trace.read("refused-charge")).steps, []);
      yield* runFeature(Features.makeBooking, {
        id: "rollback",
        guestName: "Alice",
        paymentId: "pay",
        amount: 42,
      }).pipe(Effect.provideContext(request), Effect.provide(Approval.allowAll));
      yield* provider.setFailure("refund", true);
      const failure = yield* runFeature(Features.cancelBooking, { id: "rollback" }).pipe(
        withRequestId("failed-refund"),
        Effect.provideContext(request),
        Effect.provide(Approval.allowAll),
        Effect.flip,
      );
      assert.strictEqual(failure._tag, "PaymentProviderFailed");
      assert.strictEqual(
        (yield* Context.get(ctx, Bookings).get(alice, "rollback")).status,
        "active",
      );
      assert.deepStrictEqual(
        (yield* Context.get(ctx, MyStuff).myBookings(alice)).map((r) => [
          r.status,
          r.paymentStatus,
        ]),
        [["active", "paid"]],
      );
      assert.deepStrictEqual(
        (yield* trace.read("failed-refund")).steps.map((s) => [s.target, s.outcome]),
        [
          ["Bookings.cancel", "success"],
          ["Billing.refund", "failure"],
        ],
      );
      const records = yield* CallAudit.readRows({ viewerId: alice.id }).pipe(
        Effect.provideContext(database),
      );
      assert.strictEqual(records.length, 3);
      assert.strictEqual(records.filter((r) => r.requestId === "refused-charge").length, 1);
      assert.strictEqual(records.filter((r) => r.requestId === "failed-refund").length, 1);
    }).pipe(Effect.scoped),
  30_000,
);

it.effect(
  "MyStuff filters A/B ownership in SQL including mismatched payment owners",
  () =>
    Effect.gen(function* () {
      const ctx = yield* Layer.build(
        plugSockets(modulesLayer().pipe(Layer.provide(databaseTesting))),
      );
      const bookings = Context.get(ctx, Bookings);
      const billing = Context.get(ctx, Billing);
      const read = Context.get(ctx, MyStuff);
      const a = Actor.make({ id: ActorId.make("A") });
      const b = Actor.make({ id: ActorId.make("B") });
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          for (const [id, owner] of [
            ["a", a],
            ["b", b],
            ["mixed", a],
          ] as const) {
            yield* bookings.book(owner, { id, guestName: owner.id });
            yield* billing.initPayment(id === "mixed" ? b : owner, {
              id: `pay-${id}`,
              bookingId: id,
              amount: 10,
            });
          }
        }),
      ).pipe(Effect.provideContext(ctx));
      assert.deepStrictEqual(
        (yield* read.myBookings(a)).map((row) => row.id),
        ["a"],
      );
      assert.deepStrictEqual(
        (yield* read.myBookings(b)).map((row) => row.id),
        ["b"],
      );
    }).pipe(Effect.scoped),
  30_000,
);

import { runFeature } from "@house-rules/application";
import { assert, it } from "@effect/vitest";
import { Features } from "../../features/index.ts";
import { builtInRoles, systemPermissions } from "../access.ts";
import { makeFakePaymentProvider } from "@example/billing";
import { Bookings, BookingNotFound } from "@example/bookings";
import { May, StepTrace } from "@house-rules/application";
import { Approval, CurrentActor, withRequestId } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { memoryAuditLog } from "@house-rules/call-audit";
import { Effect, Layer, Context } from "effect";
import { TestClock } from "effect/testing";
import { modulePlan, createApp } from "../app.ts";

const alice = Actor.make({ id: ActorId.make("alice") });
const input = { id: "booking", guestName: "Alice", paymentId: "payment", amount: 100 };

it.effect(
  "checks closures before work, asks once, transacts once, traces only two inner steps, and audits features",
  () =>
    Effect.gen(function* () {
      const provider = makeFakePaymentProvider();
      const log = memoryAuditLog();
      let approvals = 0;
      let transactions = 0;
      const plan = modulePlan({ provider: provider.layer, log });
      const counted = Layer.effect(
        UnitOfWork,
        Effect.gen(function* () {
          const unit = yield* UnitOfWork;
          return {
            atomic: (work) =>
              Effect.sync(() => {
                transactions++;
              }).pipe(Effect.andThen(unit.atomic(work))),
          };
        }),
      ).pipe(Layer.provideMerge(plan.layer));
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([], { modules: { ...plan, layer: counted } })),
        (app) => Effect.promise(() => app.dispose()),
      );
      const context = yield* app.runtime.contextEffect;
      const trace = Context.get(context, StepTrace);
      const bookings = Context.get(context, Bookings);
      const approval = Approval.of({
        approve: () =>
          Effect.sync(() => {
            approvals++;
          }),
      });
      const runContext = Context.add(context, CurrentActor, alice).pipe(
        Context.add(Approval, approval),
      );
      const may = (
        person: readonly `${string}:${string}`[] = builtInRoles.member.permissions,
        system: readonly `${string}:${string}`[] = systemPermissions,
      ) =>
        May.context(May.fixed(person), {
          features: Object.values(Features),
          system,
          via: "in-process",
        });

      const refused = yield* runFeature(Features.makeBooking, input).pipe(
        withRequestId("no-charge"),
        Effect.provideContext(Context.merge(runContext, may(["bookings:write"]))),
        Effect.flip,
      );
      assert.strictEqual(refused._tag, "Forbidden");
      assert.strictEqual(transactions, 0);
      assert.strictEqual(approvals, 0);
      assert.deepStrictEqual(yield* provider.calls, []);
      assert.instanceOf(yield* bookings.get(alice, input.id).pipe(Effect.flip), BookingNotFound);
      assert.deepStrictEqual((yield* trace.read("no-charge")).steps, []);
      assert.strictEqual(log.entries().length, 1);

      yield* runFeature(Features.makeBooking, input).pipe(
        withRequestId("make"),
        Effect.provideContext(Context.merge(runContext, may())),
      );
      assert.strictEqual(transactions, 1);
      assert.strictEqual(approvals, 0);
      yield* runFeature(Features.showBooking, { id: input.id }).pipe(
        Effect.provideContext(Context.merge(runContext, may())),
      );
      assert.strictEqual(transactions, 1);
      assert.strictEqual(approvals, 0);

      const denied = yield* runFeature(Features.cancelBooking, { id: input.id }).pipe(
        withRequestId("no-refund"),
        Effect.provideContext(Context.merge(runContext, may(builtInRoles.member.permissions, []))),
        Effect.flip,
      );
      assert.strictEqual(denied._tag, "Forbidden");
      assert.deepStrictEqual((yield* trace.read("no-refund")).steps, []);
      assert.strictEqual(approvals, 0);
      assert.strictEqual(transactions, 1);
      yield* runFeature(Features.cancelBooking, { id: input.id }).pipe(
        withRequestId("cancel"),
        Effect.provideContext(Context.merge(runContext, may())),
      );
      assert.strictEqual(approvals, 1);
      assert.strictEqual(transactions, 2);
      assert.deepStrictEqual(
        (yield* trace.read("cancel")).steps.map((s) => [s.target, s.caller, s.reason, s.order]),
        [
          ["Bookings.cancel", "person", null, 1],
          ["Billing.refund", "system", "refund after cancel", 2],
        ],
      );
      assert.deepStrictEqual(
        (yield* provider.calls).map((c) => c.operation),
        ["charge", "refund"],
      );
      assert.strictEqual(log.entries().length, 5);
      assert.deepStrictEqual(
        log.entries().map((e) => e.capability),
        ["make_booking", "make_booking", "show_booking", "cancel_booking", "cancel_booking"],
      );
    }).pipe(Effect.scoped),
);

it.effect("runs the schedule once using Effect Clock, expires only pending older than 24h", () =>
  Effect.gen(function* () {
    const provider = makeFakePaymentProvider({ chargeStatus: "pending" });
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([], { modules: modulePlan({ provider: provider.layer }) })),
      (app) => Effect.promise(() => app.dispose()),
    );
    const context = yield* app.runtime.contextEffect;
    const trace = Context.get(context, StepTrace);
    const request = Context.merge(
      Context.add(context, CurrentActor, alice),
      May.context(May.fixed(builtInRoles.member.permissions), {
        features: Object.values(Features),
        system: systemPermissions,
        via: "test",
      }),
    );
    yield* runFeature(Features.makeBooking, input).pipe(
      Effect.provideContext(request),
      Effect.provide(Approval.allowAll),
    );
    yield* TestClock.adjust("24 hours");
    const systemContext = Context.merge(
      context,
      May.system([Features.duePayments, Features.expirePayment], {
        system: systemPermissions,
        via: "schedule:nightly-cleanup",
      }),
    );
    const due = () =>
      runFeature(Features.duePayments, {}).pipe(Effect.provideContext(systemContext));
    assert.deepStrictEqual(yield* due(), []);
    yield* TestClock.adjust(1);
    const inputs = yield* due();
    assert.deepStrictEqual(inputs, [{ paymentId: input.paymentId }]);
    const [first] = inputs;
    assert.isDefined(first);
    const expired = yield* runFeature(Features.expirePayment, first).pipe(
      withRequestId("schedule"),
      Effect.provideContext(systemContext),
    );
    assert.strictEqual(expired.expired, 1);
    assert.deepStrictEqual(
      (yield* trace.read("schedule")).steps.map((s) => [s.feature, s.target, s.caller, s.reason]),
      [["expire_payment", "Billing.expireOne", "system", "nightly cleanup"]],
    );
  }).pipe(Effect.scoped),
);

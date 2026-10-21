import { assert, it } from "@effect/vitest";
import { call, toFetchHandler, StepTrace } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { CallAudit, memoryAuditLog } from "@house-rules/call-audit";
import { Context, Effect, Layer, Schema } from "effect";
import {
  createApp,
  Entries,
  mountMemoryModules,
  mountPostgresModules,
} from "../../../composition/index.ts";
import { databaseTesting } from "../../../composition/tests/database.ts";
import { makeFakePaymentProvider, NewPayment } from "@example/billing";
import { Bookings, BookingNotFound, NewBooking } from "@example/bookings";
import { webWay } from "../../../ways-in/web/way.ts";
import { makeBooking } from "../node.ts";

const alice = Actor.make({ id: ActorId.make("alice") });
const valid = { id: "booking", guestName: "Alice", paymentId: "payment", amount: 100 };
const invalid = [
  { ...valid, id: "" },
  { ...valid, id: "negative", amount: -1 },
  { ...valid, id: "zero", amount: 0 },
  { ...valid, id: "guest", guestName: "" },
  { ...valid, id: "payment", paymentId: "" },
];
for (const backend of ["memory", "postgres"] as const)
  it.live(
    `${backend}: reused schemas reject invalid HTTP and in-process inputs before all work`,
    () =>
      Effect.gen(function* () {
        assert.strictEqual(makeBooking.input.fields.id, NewBooking.fields.id);
        assert.strictEqual(makeBooking.input.fields.guestName, NewBooking.fields.guestName);
        assert.strictEqual(makeBooking.input.fields.paymentId, NewPayment.fields.id);
        assert.strictEqual(makeBooking.input.fields.amount, NewPayment.fields.amount);
        assert.deepStrictEqual(yield* Schema.decodeEffect(makeBooking.input)(valid), valid);
        const provider = makeFakePaymentProvider();
        const log = memoryAuditLog();
        const database = backend === "postgres" ? yield* Layer.build(databaseTesting) : undefined;
        const modules =
          database === undefined
            ? mountMemoryModules({ provider: provider.layer, log })
            : mountPostgresModules(Layer.succeedContext(database), provider.layer);
        let transactions = 0;
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
        ).pipe(Layer.provide(modules));
        const way = { ...webWay, who: { resolve: () => Effect.succeed(alice) } };
        const app = yield* Effect.acquireRelease(
          Effect.sync(() => createApp([way], { modules: Layer.merge(modules, counted) })),
          (app) => Effect.promise(() => app.dispose()),
        );
        const router = yield* Effect.acquireRelease(
          Effect.sync(() => toFetchHandler(app)),
          (router) => Effect.promise(() => router.dispose()),
        );
        const ctx = yield* app.runtime.contextEffect;
        const post = (input: typeof valid, id: string) =>
          Effect.promise(() =>
            router(
              new Request("https://booking.example/api/make_booking", {
                method: "POST",
                headers: { "x-request-id": id },
                body: JSON.stringify(input),
              }),
            ),
          );
        const records =
          database === undefined
            ? Effect.sync(() => log.entries())
            : CallAudit.readRows({ viewerId: alice.id }).pipe(Effect.provideContext(database));
        for (const [index, input] of invalid.entries()) {
          const id = `invalid-${index}`;
          assert.strictEqual((yield* post(input, id)).status, 400);
          const result = yield* Effect.promise(() =>
            call(
              app,
              Entries.makeBooking,
              input,
              { headers: new Headers({ "x-request-id": id }), url: "https://booking.example/api" },
              { way: "web" },
            ),
          );
          assert.isFalse(result.ok);
          if (!result.ok) assert.strictEqual(result.error?._tag, "InputInvalid");
          assert.deepStrictEqual(yield* Context.get(ctx, StepTrace).read(id), {
            steps: [],
            refusals: [],
          });
          assert.strictEqual(transactions, 0);
          assert.deepStrictEqual(yield* provider.calls, []);
          assert.instanceOf(
            yield* Context.get(ctx, Bookings).get(alice, input.id).pipe(Effect.flip),
            BookingNotFound,
          );
        }
        assert.strictEqual((yield* records).length, 0);
        const response = yield* post(valid, "valid-http");
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
          id: valid.id,
          guestName: valid.guestName,
          ownerId: alice.id,
          status: "active",
        });
        const second = { ...valid, id: "second", paymentId: "second-payment" };
        const result = yield* Effect.promise(() =>
          call(
            app,
            Entries.makeBooking,
            second,
            { headers: new Headers(), url: "https://booking.example/api" },
            { way: "web" },
          ),
        );
        assert.isTrue(result.ok);
        if (result.ok)
          assert.deepStrictEqual(result.value, {
            id: second.id,
            guestName: second.guestName,
            ownerId: alice.id,
            status: "active",
          });
        assert.strictEqual(transactions, 2);
        assert.deepStrictEqual(
          (yield* provider.calls).map(({ operation, payment }) => [
            operation,
            payment.id,
            payment.bookingId,
            payment.amount,
          ]),
          [
            ["charge", valid.paymentId, valid.id, valid.amount],
            ["charge", second.paymentId, second.id, second.amount],
          ],
        );
        assert.strictEqual((yield* records).length, 2);
      }).pipe(Effect.scoped),
    30_000,
  );

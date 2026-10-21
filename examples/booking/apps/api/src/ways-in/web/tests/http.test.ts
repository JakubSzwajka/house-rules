import { assert, it } from "@effect/vitest";
import {
  call,
  toFetchHandler,
  May,
  Authenticator,
  StepTrace,
  toOpenApi,
} from "@house-rules/application";
import { Actor } from "@house-rules/domain";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { memoryAuditLog } from "@house-rules/call-audit";
import { Context, Effect } from "effect";
import { createApp, DemoIssuers, modulesLayer, Entries } from "../../../composition/index.ts";
import { makeFakePaymentProvider } from "@example/billing";
import { Bookings, BookingNotFound } from "@example/bookings";
import { webWay } from "../way.ts";
import { api } from "../endpoints.ts";
import { partnerWay } from "../../partner/way.ts";
import { mcpWay } from "../../mcp/way.ts";

it.live(
  "shared entries, one authenticated hook, HTTP closure refusal, approval and independent partner issuer",
  () =>
    Effect.gen(function* () {
      const provider = makeFakePaymentProvider();
      const log = memoryAuditLog();
      let verifications = 0;
      const who = {
        resolve: (incoming: { headers: Headers; url: string }) =>
          Effect.gen(function* () {
            const demo = yield* DemoIssuers;
            const auth = yield* Authenticator.pipe(Effect.provide(demo.web.layer));
            return yield* Identity.who({ token: "bearer" })
              .resolve(incoming)
              .pipe(
                Effect.provideService(Authenticator, {
                  verify: (token, options) =>
                    Effect.sync(() => {
                      verifications++;
                    }).pipe(Effect.andThen(auth.verify(token, options))),
                }),
              );
          }),
      };
      const limited = { ...webWay, who, may: May.fixed(webWay.entries, ["bookings:write"]) };
      const app = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createApp([limited, partnerWay, mcpWay], {
            modules: modulesLayer({ provider: provider.layer, log }),
          }),
        ),
        (app) => Effect.promise(() => app.dispose()),
      );
      const router = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(app)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const ctx = yield* app.runtime.contextEffect;
      const demo = Context.get(ctx, DemoIssuers);
      const token = yield* demo.web.issue({ sub: "alice" });
      const headers = new Headers({ authorization: `Bearer ${token}`, "x-request-id": "hook-web" });
      const incoming = { headers, url: "https://booking.example/api" };
      const input = { id: "booking", guestName: "Alice", paymentId: "payment", amount: 100 };
      const post = (path: string, body: unknown, h: Headers | Record<string, string> = headers) =>
        Effect.promise(() =>
          router(
            new Request(`https://booking.example${path}`, {
              method: "POST",
              headers: h,
              body: JSON.stringify(body),
            }),
          ),
        );
      assert.strictEqual((yield* post("/api/make_booking", input)).status, 403);
      assert.strictEqual(verifications, 1);
      const identity = Context.get(ctx, Identity);
      const binding = yield* identity.resolve({ issuer: demo.web.issuer, subject: "alice" });
      assert.strictEqual(binding._tag, "Some");
      if (binding._tag !== "Some") return;
      const alice = Actor.make({ id: binding.value });
      assert.strictEqual((yield* Context.get(ctx, Party).me(alice)).id, alice.id);
      assert.instanceOf(
        yield* Context.get(ctx, Bookings).get(alice, input.id).pipe(Effect.flip),
        BookingNotFound,
      );
      assert.deepStrictEqual(yield* provider.calls, []);
      const trace = yield* Context.get(ctx, StepTrace).read("hook-web");
      assert.deepStrictEqual(
        trace.steps.map((s) => [s.entry, s.target, s.caller, s.reason]),
        [
          ["first_sign_in", "Party.createPerson", "system", "new login"],
          ["first_sign_in", "Identity.bindLogin", "system", "new login"],
        ],
      );
      assert.deepStrictEqual(
        log.entries().map((e) => [e.capability, e.requestId]),
        [
          ["first_sign_in", "hook-web"],
          ["make_booking", "hook-web"],
        ],
      );
      const refused = yield* Effect.promise(() =>
        call(app, Entries.makeBooking, input, incoming, { way: "web" }),
      );
      assert.isFalse(refused.ok);
      if (!refused.ok) assert.strictEqual(refused.error?._tag, "Forbidden");
      assert.strictEqual(log.entries().filter((e) => e.capability === "first_sign_in").length, 1);
      const partnerToken = yield* demo.partner.issue({ sub: "partner" });
      assert.strictEqual(
        (yield* post(
          "/partner/book_for_partner",
          { id: "partner", guestName: "Partner" },
          { authorization: `Bearer ${partnerToken}` },
        )).status,
        200,
      );
      assert.strictEqual(
        (yield* post("/partner/book_for_partner", { id: "bad", guestName: "Bad" })).status,
        401,
      );
      const unexposed = yield* Effect.promise(() =>
        call(
          app,
          Entries.showBooking,
          { id: "partner" },
          { headers: new Headers({ authorization: `Bearer ${partnerToken}` }), url: incoming.url },
          { way: "partner" },
        ),
      );
      assert.isFalse(unexposed.ok);
      if (!unexposed.ok) assert.strictEqual(unexposed.error?._tag, "NodeCallInvalid");
      assert.strictEqual(api.endpoints.makeBooking.entry, Entries.makeBooking);
      assert.strictEqual(api.endpoints.showBooking.entry, Entries.showBooking);
      assert.strictEqual(api.endpoints.myBookings.entry, Entries.myBookings);
      assert.strictEqual(api.endpoints.cancelBooking.entry, Entries.cancelBooking);
      assert.strictEqual(mcpWay.entries[0], Entries.showBooking);
      assert.strictEqual(mcpWay.entries[1], Entries.myBookings);
      assert.deepStrictEqual(webWay.entries, [
        Entries.makeBooking,
        Entries.showBooking,
        Entries.myBookings,
        Entries.cancelBooking,
      ]);
      assert.deepStrictEqual(partnerWay.entries, [Entries.partnerBooking]);
      const openapi = toOpenApi(Object.values(api.endpoints), { title: "Booking", version: "1" });
      assert.include(JSON.stringify(openapi), '"x-house-rules-destructive":true');
    }).pipe(Effect.scoped),
);

it.live("web denies cancel, in-process allows it, and missing database reads are unavailable", () =>
  Effect.gen(function* () {
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([webWay, partnerWay, mcpWay])),
      (app) => Effect.promise(() => app.dispose()),
    );
    const router = yield* Effect.acquireRelease(
      Effect.sync(() => toFetchHandler(app)),
      (router) => Effect.promise(() => router.dispose()),
    );
    const ctx = yield* app.runtime.contextEffect;
    const token = yield* Context.get(ctx, DemoIssuers).web.issue({ sub: "alice" });
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const incoming = { headers, url: "https://booking.example/api" };
    const post = (name: string, body: unknown) =>
      Effect.promise(() =>
        router(
          new Request(`${incoming.url}/${name}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          }),
        ),
      );
    for (const [entry, input] of [
      [Entries.partnerBooking, { id: "unexposed", guestName: "No" }],
      [{ ...Entries.showBooking }, { id: "one" }],
    ] as const) {
      const refused = yield* Effect.promise(() =>
        call(app, entry, input, incoming, { way: "web" }),
      );
      assert.isFalse(refused.ok);
      if (!refused.ok) assert.strictEqual(refused.error?._tag, "NodeCallInvalid");
    }
    assert.strictEqual(
      (yield* post("make_booking", { id: "one", guestName: "Alice", paymentId: "pay", amount: 10 }))
        .status,
      200,
    );
    assert.strictEqual((yield* post("cancel_booking", { id: "one" })).status, 403);
    assert.strictEqual((yield* post("my_bookings", {})).status, 503);
    assert.isTrue(
      (yield* Effect.promise(() =>
        call(app, Entries.cancelBooking, { id: "one" }, incoming, { way: "web" }),
      )).ok,
    );
  }).pipe(Effect.scoped),
);

it.live("refuses production demo JWT configuration", () =>
  Effect.gen(function* () {
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([webWay], { nodeEnv: "production" })),
      (app) => Effect.promise(() => app.dispose()),
    );
    assert.strictEqual((yield* app.runtime.contextEffect.pipe(Effect.flip))._tag, "DemoForbidden");
  }).pipe(Effect.scoped),
);

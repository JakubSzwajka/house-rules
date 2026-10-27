import { assert, it } from "@effect/vitest";
import { call, toFetchHandler, May, StepTrace, toOpenApi } from "@house-rules/application";
import { Actor } from "@house-rules/domain";
import { Credentials, Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { memoryAuditLog } from "@house-rules/call-audit";
import { Context, Effect } from "effect";
import { createApp, modulePlan } from "../../../composition/app.ts";
import { testIssuers } from "../../../composition/sign-in.ts";
import { Features } from "../../../features/index.ts";
import { ReadModels } from "../../../read-models/index.ts";
import { makeFakePaymentProvider } from "@example/billing";
import { Bookings, BookingNotFound } from "@example/bookings";
import { webWay } from "../way.ts";
import { api } from "../endpoints.ts";
import { firstSignInWay } from "../../hooks/first-sign-in.ts";
import { mcpWay } from "../../mcp/way.ts";

it.live("shared features, one authenticated hook, HTTP closure refusal and approval", () =>
  Effect.gen(function* () {
    const provider = makeFakePaymentProvider();
    const log = memoryAuditLog();
    let verifications = 0;
    const who = {
      resolve: (incoming: { headers: Headers; url: string }) =>
        Effect.gen(function* () {
          const auth = yield* Credentials;
          return yield* Identity.who({ token: "bearer" })
            .resolve(incoming)
            .pipe(
              Effect.provideService(Credentials, {
                verify: (token, options) =>
                  Effect.sync(() => {
                    verifications++;
                  }).pipe(Effect.andThen(auth.verify(token, options))),
              }),
            );
        }),
    };
    const limited = { ...webWay, who };
    const app = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createApp([limited, mcpWay, firstSignInWay], {
          may: May.fixed(["bookings:write", "party:read"]),
          modules: modulePlan({ provider: provider.layer, log }),
        }),
      ),
      (app) => Effect.promise(() => app.dispose()),
    );
    const router = yield* Effect.acquireRelease(
      Effect.sync(() => toFetchHandler(app)),
      (router) => Effect.promise(() => router.dispose()),
    );
    const ctx = yield* app.runtime.contextEffect;
    const demo = yield* testIssuers.pipe(Effect.provideContext(ctx));
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
    const hookRequest = log.entries().find((e) => e.capability === "first_sign_in")?.requestId;
    assert.isString(hookRequest);
    assert.notStrictEqual(hookRequest, "hook-web");
    const trace = yield* Context.get(ctx, StepTrace).read(hookRequest ?? null);
    assert.deepStrictEqual(
      trace.steps.map((s) => [s.feature, s.target, s.caller, s.reason]),
      [
        ["first_sign_in", "Party.createPerson", "system", "new login"],
        ["first_sign_in", "Party.assignRole", "system", "new login"],
        ["first_sign_in", "Identity.bindLogin", "system", "new login"],
      ],
    );
    assert.deepStrictEqual(
      log.entries().map((e) => [e.capability, e.requestId]),
      [
        ["first_sign_in", hookRequest],
        ["make_booking", "hook-web"],
      ],
    );
    const refused = yield* Effect.promise(() =>
      call(app, Features.makeBooking, input, incoming, { way: "web" }),
    );
    assert.isFalse(refused.ok);
    if (!refused.ok) assert.strictEqual(refused.error?._tag, "Forbidden");
    assert.strictEqual(log.entries().filter((e) => e.capability === "first_sign_in").length, 1);
    assert.strictEqual(api.endpoints.makeBooking.feature, Features.makeBooking);
    assert.strictEqual(api.endpoints.showBooking.feature, ReadModels.showBooking);
    assert.strictEqual(api.endpoints.myBookings.feature, ReadModels.myBookings);
    assert.strictEqual(api.endpoints.cancelBooking.feature, Features.cancelBooking);
    assert.strictEqual(mcpWay.features[0], ReadModels.showBooking);
    assert.strictEqual(mcpWay.features[1], ReadModels.myBookings);
    assert.deepStrictEqual(webWay.features, [
      Features.createOrganisation,
      ReadModels.myOrganisations,
      Features.createInvitation,
      Features.acceptInvitation,
      ReadModels.listInvitations,
      Features.revokeInvitation,
      Features.removeMember,
      ReadModels.listPeople,
      ReadModels.listMembers,
      ReadModels.myActivity,
      ReadModels.myProfile,
      ReadModels.listPermissions,
      ReadModels.recentAudit,
      Features.deleteRole,
      Features.signUp,
      Features.signIn,
      Features.signOut,
      Features.changePassword,
      Features.makeBooking,
      ReadModels.showBooking,
      ReadModels.myBookings,
      Features.cancelBooking,
      Features.defineRole,
      ReadModels.listRoles,
      Features.assignRole,
      Features.revokeRole,
    ]);
    const openapi = toOpenApi(Object.values(api.endpoints), { title: "Booking", version: "1" });
    assert.include(JSON.stringify(openapi), '"x-house-rules-destructive":true');
  }).pipe(Effect.scoped),
);

it.live(
  "web confirms cancel through Mean.allow, in-process allows it, and missing database reads are unavailable",
  () =>
    Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([webWay, mcpWay, firstSignInWay])),
        (app) => Effect.promise(() => app.dispose()),
      );
      const router = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(app)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const ctx = yield* app.runtime.contextEffect;
      const issuer = yield* Context.get(ctx, Identity).passwordIssuer();
      assert.isDefined(issuer);
      const { token } = yield* issuer.sign("alice");
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
        [ReadModels.duePayments, {}],
        [{ ...ReadModels.showBooking }, { id: "one" }],
      ] as const) {
        const refused = yield* Effect.promise(() =>
          call(app, entry, input, incoming, { way: "web" }),
        );
        assert.isFalse(refused.ok);
        if (!refused.ok) assert.strictEqual(refused.error?._tag, "CallInvalid");
      }
      assert.strictEqual(
        (yield* post("make_booking", {
          id: "one",
          guestName: "Alice",
          paymentId: "pay",
          amount: 10,
        })).status,
        200,
      );
      assert.strictEqual((yield* post("cancel_booking", { id: "one" })).status, 200);
      assert.strictEqual(
        (yield* post("make_booking", {
          id: "two",
          guestName: "Alice",
          paymentId: "pay-two",
          amount: 10,
        })).status,
        200,
      );
      assert.strictEqual((yield* post("my_bookings", {})).status, 503);
      assert.isTrue(
        (yield* Effect.promise(() =>
          call(app, Features.cancelBooking, { id: "two" }, incoming, { way: "web" }),
        )).ok,
      );
    }).pipe(Effect.scoped),
);

it.live("refuses production password signing without ACCOUNTS_SIGNING_KEY", () =>
  Effect.gen(function* () {
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([webWay], { nodeEnv: "production" })),
      (app) => Effect.promise(() => app.dispose()),
    );
    assert.strictEqual(
      (yield* app.runtime.contextEffect.pipe(Effect.flip))._tag,
      "IdentityProviderInvalid",
    );
  }).pipe(Effect.scoped),
);

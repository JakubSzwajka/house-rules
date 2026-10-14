import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import {
  Approval,
  ApprovalDenied,
  admit,
  call,
  CallChannel,
  CallRequestId,
  composition,
  defineContract,
  implement,
  NoInput,
  problemView,
  Refused,
} from "../index.ts";
import {
  Bookings,
  makeApp,
  sessionCallerFor,
  showBooking,
  Requester,
} from "./delivery-fixtures.ts";

const t = makeApp();
const disposers: Array<() => Promise<void>> = [t.dispose];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));

const incoming = {
  headers: new Headers({ cookie: "session=s-ada", "x-request-id": "admit-1" }),
  url: "/bookings",
};

const trace = implement(
  defineContract("trace_admitted", {
    description: "Read the resolved caller and request trace.",
    input: NoInput,
    output: Schema.Struct({
      userId: Schema.String,
      requestId: Schema.NullOr(Schema.String),
      channel: Schema.String,
    }),
    failure: Schema.Never,
    permission: "public",
  }),
  () =>
    Effect.gen(function* traceAdmitted() {
      return {
        userId: (yield* Requester).userId,
        requestId: yield* CallRequestId,
        channel: yield* CallChannel,
      };
    }),
);

const approved = implement(
  defineContract("approved_admitted", {
    description: "Check approval after caller resolution.",
    input: NoInput,
    output: Schema.Boolean,
    failure: Schema.Never,
    permission: "public",
    needsApproval: true,
  }),
  () => Effect.succeed(true),
);

const internal = {
  ok: false,
  error: undefined,
  view: {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong on the server." } },
  },
};

it.effect(
  "admit() refuses before delivery input parsing with the Refused status, code and message",
  () =>
    Effect.gen(function* refusesBeforeParsing() {
      let parsed = false;
      const refusal = new Refused({
        status: 403,
        code: "scope_too_wide",
        message: "A read token cannot change anything.",
        challenge: "Bearer",
      });
      const auth = yield* Effect.promise(() =>
        admit(t.app, incoming, { caller: () => Effect.fail(refusal) }),
      );
      const result = auth.ok
        ? yield* Effect.promise(() => {
            parsed = true;
            return call(t.app, showBooking, { id: "b-1" }, incoming, { admitted: auth.value });
          })
        : auth;
      expect(parsed).toBe(false);
      expect(result).toEqual({
        ok: false,
        error: refusal,
        view: {
          status: 403,
          body: { error: { code: refusal.code, message: refusal.message } },
          headers: { "www-authenticate": "Bearer" },
        },
      });
    }),
);

it.effect("admit() uses the composition's Refused view over the default", () =>
  Effect.gen(function* appRefusalView() {
    const app = composition({
      layer: Layer.empty,
      caller: () => Effect.fail(new Refused({ status: 401, code: "missing", message: "Sign in." })),
      views: { Refused: problemView(403, "hidden", (_error: Refused) => "Not allowed.") },
    });
    disposers.push(app.dispose);
    const auth = yield* Effect.promise(() => admit(app, incoming));
    expect(auth.ok).toBe(false);
    if (auth.ok) return expect.unreachable();
    expect(auth.view).toEqual({
      status: 403,
      body: { error: { code: "hidden", message: "Not allowed." } },
    });
  }),
);

it.effect(
  "admit() then two call()s run the caller once and keep its request id and log annotation",
  () =>
    Effect.gen(function* reuseCaller() {
      const before = t.work.callers;
      const auth = yield* Effect.promise(() =>
        admit(t.app, incoming, {
          caller: (request) =>
            Effect.gen(function* callerWithTrace() {
              yield* Bookings;
              expect(yield* CallRequestId).toBe("admit-1");
              expect(yield* CallChannel).toBe("api");
              yield* Effect.logInfo("Admitted caller trace");
              return yield* sessionCallerFor(t.work)(request);
            }),
          channel: "api",
        }),
      );
      if (!auth.ok) return expect.unreachable();
      const first = yield* Effect.promise(() =>
        call(t.app, showBooking, { id: "b-1" }, incoming, { admitted: auth.value }),
      );
      const second = yield* Effect.promise(() =>
        call(t.app, trace, {}, incoming, { admitted: auth.value, channel: "api" }),
      );
      expect(first).toMatchObject({ ok: true, value: { id: "b-1" } });
      expect(second).toEqual({
        ok: true,
        value: { userId: "ada", requestId: "admit-1", channel: "api" },
      });
      expect(t.work.callers - before).toBe(1);
      expect(
        t.logs.find((line) => JSON.stringify(line.message).includes("Admitted caller trace")),
      ).toMatchObject({
        annotations: { requestId: "admit-1" },
      });
    }),
);

it.effect("call() keeps the admitted channel unless its own channel overrides it", () =>
  Effect.gen(function* admittedChannel() {
    const auth = yield* Effect.promise(() => admit(t.app, incoming, { channel: "api" }));
    if (!auth.ok) return expect.unreachable();
    const kept = yield* Effect.promise(() =>
      call(t.app, trace, {}, incoming, { admitted: auth.value }),
    );
    const overridden = yield* Effect.promise(() =>
      call(t.app, trace, {}, incoming, { admitted: auth.value, channel: "web" }),
    );
    expect(kept).toEqual({
      ok: true,
      value: { userId: "ada", requestId: "admit-1", channel: "api" },
    });
    expect(overridden).toEqual({
      ok: true,
      value: { userId: "ada", requestId: "admit-1", channel: "web" },
    });
  }),
);

it.effect("admit() defaults to app.caller and keeps a generated request id across calls", () =>
  Effect.gen(function* generatedTrace() {
    const request = { headers: new Headers({ cookie: "session=s-ada" }), url: "/" };
    const before = t.work.callers;
    const auth = yield* Effect.promise(() => admit(t.app, request));
    if (!auth.ok) return expect.unreachable();
    const first = yield* Effect.promise(() =>
      call(t.app, trace, {}, request, { admitted: auth.value }),
    );
    const second = yield* Effect.promise(() =>
      call(t.app, trace, {}, request, { admitted: auth.value }),
    );
    expect(first).toEqual(second);
    if (!first.ok) return expect.unreachable();
    expect(first.value.requestId).toMatch(/^[a-f0-9]{32}$/u);
    expect(first.value.channel).toBe("web");
    expect(t.work.callers - before).toBe(1);
  }),
);

it.effect("admitted calls keep approval precedence and fromCaller reads the resolved context", () =>
  Effect.gen(function* resolvedApproval() {
    const auth = yield* Effect.promise(() =>
      admit(t.app, incoming, {
        caller: (request) =>
          sessionCallerFor(t.work)(request).pipe(
            Effect.map((context) =>
              Context.add(context, Approval, {
                approve: (capabilityName) =>
                  Effect.fail(
                    new ApprovalDenied({ capabilityName, reason: "Caller requires approval" }),
                  ),
              }),
            ),
          ),
      }),
    );
    if (!auth.ok) return expect.unreachable();
    const defaults = yield* Effect.promise(() =>
      call(t.app, approved, {}, incoming, { admitted: auth.value }),
    );
    const fromCaller = yield* Effect.promise(() =>
      call(t.app, approved, {}, incoming, { admitted: auth.value, approval: "fromCaller" }),
    );
    const explicit = yield* Effect.promise(() =>
      call(t.app, approved, {}, incoming, {
        admitted: auth.value,
        approval: Approval.allowAll,
      }),
    );
    const denied = yield* Effect.promise(() =>
      call(t.app, approved, {}, incoming, { admitted: auth.value, approval: Approval.denyAll }),
    );
    expect([defaults.ok, fromCaller.ok, explicit.ok, denied.ok]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(fromCaller).toMatchObject({ error: { _tag: "ApprovalDenied" } });
    const noApproval = yield* Effect.promise(() => admit(t.app, incoming));
    if (!noApproval.ok) return expect.unreachable();
    expect(
      yield* Effect.promise(() =>
        call(t.app, approved, {}, incoming, {
          admitted: noApproval.value,
          approval: "fromCaller",
        }),
      ),
    ).toEqual({ ok: true, value: true });
  }),
);

it.effect("admit() logs a caller defect with the request id and returns internal_error", () =>
  Effect.gen(function* dyingCaller() {
    const start = t.logs.length;
    const auth = yield* Effect.promise(() =>
      admit(t.app, incoming, { caller: () => Effect.die("caller bug") }),
    );
    expect(auth).toEqual(internal);
    expect(t.logs.slice(start)).toContainEqual(
      expect.objectContaining({ annotations: { requestId: "admit-1" } }),
    );
  }),
);

it.effect(
  "call() rejects Admitted from another composition without running its caller or capability",
  () =>
    Effect.gen(function* wrongComposition() {
      const other = makeApp();
      disposers.push(other.dispose);
      const auth = yield* Effect.promise(() => admit(other.app, incoming));
      if (!auth.ok) return expect.unreachable();
      const before = { ...t.work };
      const start = t.logs.length;
      expect(
        yield* Effect.promise(() =>
          call(t.app, showBooking, { id: "b-1" }, incoming, { admitted: auth.value }),
        ),
      ).toEqual(internal);
      expect(t.work).toEqual(before);
      expect(t.logs.slice(start)).toContainEqual(
        expect.objectContaining({
          annotations: expect.objectContaining({ requestId: "admit-1" }),
        }),
      );
    }),
);

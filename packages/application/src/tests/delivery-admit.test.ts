import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Logger, References, Schema } from "effect";
import { admit, call, CallChannel, CallRequestId, endpoint, Refused } from "../index.ts";
import { bindFixture, testActor } from "./execution-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";

const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const incoming = { headers: new Headers({ "x-request-id": "admit-1" }), url: "/" };
const trace = bindFixture(
  featureFixture(
    defineOperation("trace_admitted", {
      description: "Read the caller and request trace.",
      input: NoInput,
      output: Schema.Struct({
        userId: Schema.String,
        requestId: Schema.NullOr(Schema.String),
        channel: Schema.String,
      }),
      failure: Schema.Never,
      permission: null,
    }),
  ),
  (_input, scope) =>
    Effect.gen(function* () {
      return {
        userId: scope.caller.kind === "person" ? scope.caller.actor.id : "system",
        requestId: yield* CallRequestId,
        channel: yield* CallChannel,
      };
    }),
);
const approved = bindFixture(
  featureFixture(
    defineOperation("approved_admitted", {
      description: "Ask once for approval.",
      input: NoInput,
      output: Schema.Boolean,
      failure: Schema.Never,
      permission: null,
      needsApproval: true,
    }),
  ),
  () => Effect.succeed(true),
);
let callers = 0;
const logs: Array<{ message: unknown; annotations: Readonly<Record<string, unknown>> }> = [];
const fixture = httpFixture([trace, approved], {
  endpoints: [endpoint(trace), endpoint(approved)],
  who: {
    resolve: () =>
      Effect.gen(function* () {
        callers += 1;
        yield* Effect.logInfo("Admitted caller trace");
        return testActor;
      }),
  },
  extra: Logger.layer([
    Logger.make(({ message, fiber }) => {
      logs.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
    }),
  ]),
});
disposers.push(fixture.dispose);
const internal = {
  ok: false,
  error: undefined,
  view: {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong on the server." } },
  },
};

it.effect("admit refuses before input parsing with the protocol status, code and challenge", () =>
  Effect.gen(function* () {
    let parsed = false;
    const refusal = new Refused({
      status: 403,
      code: "scope_too_wide",
      message: "A read token cannot change anything.",
      challenge: "Bearer",
    });
    const denied = httpFixture([trace], {
      endpoints: [endpoint(trace)],
      who: { resolve: () => Effect.fail(refusal) },
    });
    disposers.push(denied.dispose);
    const auth = yield* Effect.promise(() => admit(denied.app, incoming, { way: "web" }));
    if (auth.ok) {
      parsed = true;
      yield* Effect.promise(() =>
        call(denied.app, trace, {}, incoming, { way: "web", admitted: auth.value }),
      );
    }
    expect(parsed).toBe(false);
    expect(auth).toEqual({
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

it.effect("admission protocol errors cannot be replaced by callable wording overrides", () =>
  Effect.gen(function* () {
    const denied = httpFixture([trace], {
      endpoints: [endpoint(trace)],
      who: {
        resolve: () =>
          Effect.fail(new Refused({ status: 401, code: "missing", message: "Sign in." })),
      },
      // @ts-expect-error Refused is a protocol error, not a callable wording tag.
      overrides: { Refused: () => "Hidden" },
    });
    disposers.push(denied.dispose);
    const result = yield* Effect.promise(() => admit(denied.app, incoming, { way: "web" }));
    expect(result).toMatchObject({
      ok: false,
      view: { status: 401, body: { error: { code: "missing", message: "Sign in." } } },
    });
  }),
);

it.effect("admit then two calls run Who once and keep request id, actor and channel", () =>
  Effect.gen(function* () {
    const before = callers;
    const auth = yield* Effect.promise(() =>
      admit(fixture.app, incoming, { way: "web", channel: "api" }),
    );
    if (!auth.ok) return expect.unreachable();
    const first = yield* Effect.promise(() =>
      call(fixture.app, trace, {}, incoming, { way: "web", admitted: auth.value }),
    );
    const second = yield* Effect.promise(() =>
      call(fixture.app, trace, {}, incoming, { way: "web", admitted: auth.value }),
    );
    expect(first).toEqual({
      ok: true,
      value: { userId: "ada", requestId: "admit-1", channel: "api" },
    });
    expect(second).toEqual(first);
    expect(callers - before).toBe(1);
    expect(logs).toContainEqual(
      expect.objectContaining({ annotations: expect.objectContaining({ requestId: "admit-1" }) }),
    );
  }),
);

it("call has no per-call channel override beside its admitted request", () => {
  const invalid = () =>
    call(fixture.app, trace, {}, incoming, {
      way: "web",
      // @ts-expect-error Channel belongs to admission, not a second call override.
      channel: "other",
    });
  expect(typeof invalid).toBe("function");
});

it.effect("admission generates one id and keeps it across calls", () =>
  Effect.gen(function* () {
    const request = { headers: new Headers(), url: "/" };
    const before = callers;
    const auth = yield* Effect.promise(() => admit(fixture.app, request, { way: "web" }));
    if (!auth.ok) return expect.unreachable();
    const first = yield* Effect.promise(() =>
      call(fixture.app, trace, {}, request, { way: "web", admitted: auth.value }),
    );
    const second = yield* Effect.promise(() =>
      call(fixture.app, trace, {}, request, { way: "web", admitted: auth.value }),
    );
    expect(first).toEqual(second);
    if (!first.ok) return expect.unreachable();
    expect(first.value.requestId).toMatch(/^[a-f0-9]{32}$/u);
    expect(first.value.channel).toBe("web");
    expect(callers - before).toBe(1);
  }),
);

it.effect("in-process admitted calls approve without allowing caller or approval overrides", () =>
  Effect.gen(function* () {
    const auth = yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }));
    if (!auth.ok) return expect.unreachable();
    expect(
      yield* Effect.promise(() =>
        call(fixture.app, approved, {}, incoming, { way: "web", admitted: auth.value }),
      ),
    ).toEqual({ ok: true, value: true });
    const invalid = () =>
      call(fixture.app, approved, {}, incoming, {
        way: "web",
        admitted: auth.value,
        // @ts-expect-error The in-process runner owns approval.
        approval: "fromCaller",
      });
    expect(typeof invalid).toBe("function");
  }),
);

it.effect("a dying Who answers internal_error with the request id in its log", () =>
  Effect.gen(function* () {
    const dying = httpFixture([trace], {
      endpoints: [endpoint(trace)],
      who: { resolve: () => Effect.die("caller bug") },
      extra: Logger.layer([
        Logger.make(({ message, fiber }) => {
          logs.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
        }),
      ]),
    });
    disposers.push(dying.dispose);
    const result = yield* Effect.promise(() => admit(dying.app, incoming, { way: "web" }));
    expect(result).toEqual(internal);
    expect(logs).toContainEqual(
      expect.objectContaining({ annotations: expect.objectContaining({ requestId: "admit-1" }) }),
    );
  }),
);

it.effect("an admitted value from another composition never runs Who or a callable", () =>
  Effect.gen(function* () {
    const other = httpFixture([trace], { endpoints: [endpoint(trace)] });
    disposers.push(other.dispose);
    const auth = yield* Effect.promise(() => admit(other.app, incoming, { way: "web" }));
    if (!auth.ok) return expect.unreachable();
    const before = callers;
    expect(
      yield* Effect.promise(() =>
        call(fixture.app, trace, {}, incoming, { way: "web", admitted: auth.value }),
      ),
    ).toEqual(internal);
    expect(callers).toBe(before);
  }),
);

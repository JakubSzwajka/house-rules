import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation, errorKind, NoInput } from "@house-rules/domain";
import { Deferred, Effect, Layer, Schema } from "effect";
import { admit, CompositionClosed, endpoint } from "../index.ts";
import { bindFixture, testActor } from "./execution-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
const incoming = { headers: new Headers({ "x-request-id": "admit-lifecycle" }), url: "/" };
const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const internal = {
  ok: false,
  error: undefined,
  view: {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong on the server." } },
  },
};
const ping = bindFixture(
  featureFixture(
    defineOperation("ping", {
      description: "Read.",
      input: NoInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
    }),
  ),
  () => Effect.void,
);
class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {
  kind: errorKind("unavailable"),
}) {
  override get message(): string {
    return "Try again.";
  }
}
it.effect("admission after dispose never builds or calls Who", () =>
  Effect.gen(function* () {
    let builds = 0;
    let callers = 0;
    const fixture = httpFixture([ping], {
      endpoints: [endpoint(ping)],
      extra: Layer.effectDiscard(
        Effect.sync(() => {
          builds += 1;
        }),
      ),
      who: {
        resolve: () =>
          Effect.sync(() => {
            callers += 1;
            return testActor;
          }),
      },
    });
    disposers.push(fixture.dispose);
    yield* Effect.promise(fixture.app.dispose);
    const result = yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }));
    if (result.ok) return expect.unreachable();
    expect(result.error).toBeInstanceOf(CompositionClosed);
    expect(result.view.status).toBe(503);
    expect([builds, callers]).toEqual([0, 0]);
  }),
);
it.effect("admission maps a kinded layer failure and retries on its next build", () =>
  Effect.gen(function* () {
    let builds = 0;
    let callers = 0;
    const fixture = httpFixture([ping], {
      endpoints: [endpoint(ping)],
      extra: Layer.effectDiscard(
        Effect.suspend(() => {
          builds += 1;
          return builds === 1 ? Effect.fail(new DbUnavailable()) : Effect.void;
        }),
      ),
      who: {
        resolve: () =>
          Effect.sync(() => {
            callers += 1;
            return testActor;
          }),
      },
    });
    disposers.push(fixture.dispose);
    const first = yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }));
    if (first.ok) return expect.unreachable();
    expect(first.error).toBeInstanceOf(DbUnavailable);
    expect(first.view).toEqual({
      status: 503,
      code: "unavailable",
      body: { error: { code: "unavailable", message: "Try again." } },
    });
    expect(callers).toBe(0);
    expect((yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }))).ok).toBe(
      true,
    );
    expect([builds, callers]).toEqual([2, 1]);
  }),
);
it.effect("a dying admission layer returns the fixed internal error", () =>
  Effect.gen(function* () {
    const fixture = httpFixture([ping], {
      endpoints: [endpoint(ping)],
      extra: Layer.effectDiscard(Effect.die("layer bug")),
    });
    disposers.push(fixture.dispose);
    expect(yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }))).toEqual(
      internal,
    );
  }),
);
it.effect("dispose interrupts an inflight admission and returns CompositionClosed", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fixture = httpFixture([ping], {
      endpoints: [endpoint(ping)],
      who: {
        resolve: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      },
    });
    disposers.push(fixture.dispose);
    const pending = admit(fixture.app, incoming, { way: "web" });
    yield* Deferred.await(started);
    yield* Effect.promise(fixture.app.dispose);
    const result = yield* Effect.promise(() => pending);
    if (result.ok) return expect.unreachable();
    expect(result.error).toBeInstanceOf(CompositionClosed);
    expect(result.view.status).toBe(503);
  }),
);

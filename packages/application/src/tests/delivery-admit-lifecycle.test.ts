import { afterAll, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Layer, Schema } from "effect";
import { admit, composition, CompositionClosed, problemView } from "../index.ts";

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

it.effect("admit() after dispose returns CompositionClosed without building or calling", () =>
  Effect.gen(function* closedAdmission() {
    let builds = 0;
    let callers = 0;
    const app = composition({
      layer: Layer.effectDiscard(
        Effect.sync(() => {
          builds += 1;
        }),
      ),
      caller: () =>
        Effect.sync(() => {
          callers += 1;
          return Context.empty();
        }),
    });
    yield* Effect.promise(app.dispose);
    const auth = yield* Effect.promise(() => admit(app, incoming));
    if (auth.ok) return expect.unreachable();
    expect(auth.error).toBeInstanceOf(CompositionClosed);
    expect(auth.view.status).toBe(503);
    expect([builds, callers]).toEqual([0, 0]);
  }),
);

class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {}) {}

it.effect("admit() maps a failed app layer through its view and retries the next build", () =>
  Effect.gen(function* failedAdmissionLayer() {
    let builds = 0;
    let callers = 0;
    const app = composition({
      layer: Layer.effectDiscard(
        Effect.suspend(() => {
          builds += 1;
          return builds === 1 ? Effect.fail(new DbUnavailable()) : Effect.void;
        }),
      ),
      caller: () =>
        Effect.sync(() => {
          callers += 1;
          return Context.empty();
        }),
      views: {
        DbUnavailable: problemView(503, "unavailable", (_error: DbUnavailable) => "Try again."),
      },
    });
    disposers.push(app.dispose);
    const first = yield* Effect.promise(() => admit(app, incoming));
    if (first.ok) return expect.unreachable();
    expect(first.error).toBeInstanceOf(DbUnavailable);
    expect(first.view).toEqual({
      status: 503,
      body: { error: { code: "unavailable", message: "Try again." } },
    });
    expect(callers).toBe(0);
    expect((yield* Effect.promise(() => admit(app, incoming))).ok).toBe(true);
    expect([builds, callers]).toEqual([2, 1]);
  }),
);

it.effect("admit() maps a dying app layer to the fixed internal error", () =>
  Effect.gen(function* dyingAdmissionLayer() {
    const app = composition({
      layer: Layer.effectDiscard(Effect.die("layer bug")),
      caller: () => Effect.succeed(Context.empty()),
    });
    disposers.push(app.dispose);
    expect(yield* Effect.promise(() => admit(app, incoming))).toEqual(internal);
  }),
);

it.effect("dispose interrupts an in-flight admission and returns the closed view", () =>
  Effect.gen(function* interruptAdmission() {
    const started = yield* Deferred.make<void>();
    const app = composition({
      layer: Layer.empty,
      caller: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    });
    const pending = admit(app, incoming);
    yield* Deferred.await(started);
    yield* Effect.promise(app.dispose);
    const auth = yield* Effect.promise(() => pending);
    if (auth.ok) return expect.unreachable();
    expect(auth.error).toBeInstanceOf(CompositionClosed);
    expect(auth.view.status).toBe(503);
  }),
);

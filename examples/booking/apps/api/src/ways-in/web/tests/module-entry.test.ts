import { assert, it } from "@effect/vitest";
import { BookingsOperations } from "@example/bookings";
import { defineFeature, defineWay, GraphInvalid } from "@house-rules/application";
import { endpoint } from "@house-rules/application/contract";
import { Effect } from "effect";
import { createApp } from "../../../composition/index.ts";
import { webWay } from "../way.ts";

it.effect("composition refuses a way exposing a forged Bookings.get module entry", () =>
  Effect.gen(function* () {
    // A feature must still belong to the app's registered feature set.
    const forged = defineFeature(BookingsOperations.get.name, {
      ...BookingsOperations.get,
      edges: [BookingsOperations.get],
      handler: (input, { call }) => call(BookingsOperations.get, input),
    });
    const way = defineWay({
      ...webWay,
      protocol: "http",
      features: [forged],
      public: [],
      endpoints: [endpoint(forged)],
    });
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([way])),
      (app) => Effect.promise(() => app.dispose()),
    );
    const error = yield* app.runtime.contextEffect.pipe(Effect.flip);
    assert.instanceOf(error, GraphInvalid);
    assert.strictEqual(error.reason, "web exposes an unregistered feature Bookings.get");
  }).pipe(Effect.scoped),
);

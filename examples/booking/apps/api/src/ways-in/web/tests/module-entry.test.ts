import { assert, it } from "@effect/vitest";
import { BookingsNodes } from "@example/bookings";
import { defineEntry, defineWay, GraphInvalid, May } from "@house-rules/application";
import { endpoint } from "@house-rules/application/contract";
import { Effect } from "effect";
import { createApp } from "../../../composition/index.ts";
import { webWay } from "../way.ts";

it.effect("composition refuses a way exposing a forged Bookings.get module entry", () =>
  Effect.gen(function* () {
    // Tests can bypass the app-node lint fence through the public builder.
    const forged = defineEntry(BookingsNodes.get);
    const way = defineWay({
      ...webWay,
      protocol: "http",
      entries: [forged],
      endpoints: [endpoint(forged)],
      may: May.fixed([forged], ["bookings:read"]),
    });
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([way])),
      (app) => Effect.promise(() => app.dispose()),
    );
    const error = yield* app.runtime.contextEffect.pipe(Effect.flip);
    assert.instanceOf(error, GraphInvalid);
    assert.strictEqual(error.reason, "web exposes an unregistered entry Bookings.get");
  }).pipe(Effect.scoped),
);

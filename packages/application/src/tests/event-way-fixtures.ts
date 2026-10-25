import { memoryUnitOfWork } from "@house-rules/domain";
import { TestClock } from "effect/testing";
import { Effect, Layer, Schema, Stream } from "effect";
import {
  composition,
  defineFeature,
  defineWay,
  EventInput,
  EventSource,
  May,
  Mean,
  StepTrace,
  systemStart,
} from "../index.ts";

export const waitTesting = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.raceFirst(effect, TestClock.withLive(Effect.never.pipe(Effect.timeout("2 seconds"))));

export const featureTesting = defineFeature("react", {
  description: "React to an event.",
  input: EventInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
  start: systemStart("event reaction", "event:react"),
  handler: () => Effect.void,
});
export const wayTesting = defineWay({
  protocol: "event",
  name: "react",
  on: ["changed"],
  feature: featureTesting,
  mean: Mean.no,
});
export const sourceTesting = (kinds: readonly string[]): EventSource["Service"] => ({
  consumers: [{ name: "react", kinds }],
  claimDue: () => Effect.succeed([]),
  takeNext: () => Effect.succeed(null),
  settleSuccess: () => Effect.succeed(true),
  settleFailure: () => Effect.succeed(true),
  wake: Stream.never,
});
export const appForTesting = (
  ways = [wayTesting],
  plug: EventSource["Service"] | null = sourceTesting(["changed"]),
) =>
  composition({
    modules: {
      mounts: [],
      layer: Layer.mergeAll(
        memoryUnitOfWork,
        StepTrace.layer(),
        ...(plug === null ? [] : [Layer.succeed(EventSource, plug)]),
      ),
    },
    features: [featureTesting],
    ways,
    may: Effect.succeed(May.fixed([])),
    system: [],
  });

import { installFixture } from "./feature-fixtures.ts";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  type AnyFeature,
  type Binding,
  CurrentActor,
  type InnerFailure,
  May,
  Runtime,
  type CallScope,
  runFeature,
  StepTrace,
} from "../index.ts";

declare const capturedServices: unique symbol;
export type Fixture<E extends AnyFeature, R> = E & { readonly [capturedServices]?: R };
type Captured<E> = typeof capturedServices extends keyof E
  ? Exclude<E[typeof capturedServices & keyof E], undefined>
  : never;
type Services = NonNullable<unknown> | null | undefined;
const builders = new WeakMap<AnyFeature, Effect.Effect<void, never, Services>>();
export const testActor = Actor.make({ id: ActorId.make("ada") });

export const bindFixture = <E extends AnyFeature, R>(
  feature: E,
  handler: (
    input: E["input"]["Type"],
    scope: CallScope<E>,
  ) => Effect.Effect<E["output"]["Type"], E["failure"]["Type"] | InnerFailure, R>,
): Fixture<E, R> => {
  const build = Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const run: Binding["run"] = (input, scope) =>
      handler(input as E["input"]["Type"], scope as CallScope<E>).pipe(
        Effect.provideContext(context),
      );
    installFixture(feature, run);
  });
  builders.set(feature, build);
  return feature;
};

export const fixtureLayer = <const Features extends readonly AnyFeature[]>(features: Features) => {
  const make = Effect.gen(function* () {
    yield* Effect.forEach(
      features,
      (feature) => builders.get(feature) ?? Effect.die("Feature has no fixture binding"),
    );
    return yield* Runtime.make({ bindings: [], features: features, ways: [] });
  });
  // The fixture brand records the services each builder captures once during acquisition.
  const layer = Layer.effect(Runtime, make) as unknown as Layer.Layer<
    Runtime,
    import("../index.ts").GraphInvalid,
    Captured<Features[number]>
  >;
  return Layer.merge(layer, StepTrace.layer());
};

export const runFixture = <E extends AnyFeature>(
  feature: E,
  input: E["input"]["Type"],
  may?: import("../index.ts").MaySocket<unknown>,
) =>
  runFeature(feature, input).pipe(
    Effect.provide(fixtureLayer([feature])),
    Effect.provideContext(
      May.context(may ?? May.fixed(feature.closures.person), {
        features: [feature],
        system: feature.closures.system,
        via: "test",
      }),
    ),
    Effect.provideService(CurrentActor, testActor),
  );

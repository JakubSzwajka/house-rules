import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  type AnyEntry,
  type Binding,
  bindNode,
  CurrentActor,
  type InnerFailure,
  May,
  NodeRuntime,
  type NodeScope,
  runEntry,
  StepTrace,
} from "../index.ts";

declare const capturedServices: unique symbol;
export type Fixture<E extends AnyEntry, R> = E & { readonly [capturedServices]?: R };
type Captured<E> = typeof capturedServices extends keyof E
  ? Exclude<E[typeof capturedServices & keyof E], undefined>
  : never;
type Services = NonNullable<unknown> | null | undefined;
const builders = new WeakMap<AnyEntry, Effect.Effect<Binding, never, Services>>();
export const testActor = Actor.make({ id: ActorId.make("ada") });

export const bindFixture = <E extends AnyEntry, R>(
  entry: E,
  handler: (
    input: E["node"]["input"]["Type"],
    scope: NodeScope<E["node"]>,
  ) => Effect.Effect<E["node"]["output"]["Type"], E["node"]["failure"]["Type"] | InnerFailure, R>,
): Fixture<E, R> => {
  const build = Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    return bindNode(entry.node, (input, scope) =>
      handler(input, scope).pipe(Effect.provideContext(context)),
    );
  });
  builders.set(entry, build);
  return entry;
};

export const fixtureLayer = <const Entries extends readonly AnyEntry[]>(entries: Entries) => {
  const make = Effect.gen(function* () {
    const bindings = yield* Effect.forEach(
      entries,
      (entry) => builders.get(entry) ?? Effect.die("Entry has no fixture binding"),
    );
    return yield* NodeRuntime.make({ bindings, entries, ways: [] });
  });
  // The fixture brand records the services each builder captures once during acquisition.
  const layer = Layer.effect(NodeRuntime, make) as unknown as Layer.Layer<
    NodeRuntime,
    import("../index.ts").GraphInvalid,
    Captured<Entries[number]>
  >;
  return Layer.merge(layer, StepTrace.layer());
};

export const runFixture = <E extends AnyEntry>(
  entry: E,
  input: E["node"]["input"]["Type"],
  may?: import("../index.ts").MaySocket,
) =>
  runEntry(entry, input).pipe(
    Effect.provide(fixtureLayer([entry])),
    Effect.provideContext(
      May.context(may ?? May.fixed([entry], entry.closures.person), {
        system: entry.closures.system,
        via: "test",
      }),
    ),
    Effect.provideService(CurrentActor, testActor),
  );

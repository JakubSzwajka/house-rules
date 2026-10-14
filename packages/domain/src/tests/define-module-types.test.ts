import { expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema, type Scope } from "effect";
import { type Actor, defineModule, type ModuleShape, PerRequest } from "../index.ts";

class Port extends Context.Service<Port, { readonly value: string }>()("test/module/Port") {}
class RequestActor extends Context.Service<RequestActor, Actor>()("test/module/RequestActor") {
  declare readonly [PerRequest]: typeof PerRequest;
}
class RequestLocale extends Context.Service<RequestLocale, string>()("test/module/RequestLocale") {
  declare readonly [PerRequest]: typeof PerRequest;
}
class BuildFailed extends Schema.TaggedError<BuildFailed>()("BuildFailed", {}) {}
class MethodFailed extends Schema.TaggedError<MethodFailed>()("MethodFailed", {}) {}

type Shape = { readonly read: (actor: Actor) => Effect.Effect<string, MethodFailed> };
type LeakedPort = { readonly read: () => Effect.Effect<string, never, Port> };
type LeakedRequest = { readonly read: () => Effect.Effect<Actor, never, RequestActor> };

class Plain extends defineModule<Plain, Shape>()("test/module/Plain", {
  make: Effect.gen(function* () {
    const port = yield* Port;
    yield* Effect.acquireRelease(Effect.void, () => Effect.void);
    yield* Effect.succeed(true).pipe(Effect.filterOrFail(Boolean, () => new BuildFailed()));
    return { read: (_actor: Actor) => Effect.succeed(port.value) };
  }),
}) {}

class Configured extends defineModule<Configured, Shape>()("test/module/Configured", {
  make: (options: { readonly prefix: string }) =>
    Effect.gen(function* () {
      const port = yield* Port;
      yield* Effect.succeed(true).pipe(Effect.filterOrFail(Boolean, () => new BuildFailed()));
      return { read: (_actor: Actor) => Effect.succeed(options.prefix + port.value) };
    }),
}) {
  static readonly presets = { default: { prefix: "Hello " } };
}

const fixtures = () => [
  Plain.id satisfies "test/module/Plain",
  Plain.key satisfies "test/module/Plain",
  Plain.make satisfies Effect.Effect<Shape, BuildFailed, Port | Scope.Scope>,
  Plain.layer satisfies Layer.Layer<Plain, BuildFailed, Port>,
  Configured.layer(Configured.presets.default) satisfies Layer.Layer<Configured, BuildFailed, Port>,
  Configured.make(Configured.presets.default) satisfies Effect.Effect<Shape, BuildFailed, Port>,
  // @ts-expect-error the options are required.
  Configured.layer(),
  defineModule<Plain, Shape>()("test/module/RequestActor", {
    // @ts-expect-error make cannot capture request identity.
    make: Effect.map(RequestActor, (actor) => ({ read: () => Effect.succeed(actor.id) })),
  }),
  defineModule<Plain, Shape>()("test/module/OptionsRequestActor", {
    // @ts-expect-error options make cannot capture request identity.
    make: (_options: { readonly prefix: string }) =>
      Effect.map(RequestActor, (actor) => ({ read: () => Effect.succeed(actor.id) })),
  }),
  defineModule<Plain, Shape>()("test/module/UnionRequestActor", {
    // @ts-expect-error RequestActor cannot hide in a union of acquisition requirements.
    make: Effect.gen(function* () {
      const actor = yield* RequestActor;
      yield* Port;
      return { read: () => Effect.succeed(actor.id) };
    }),
  }),
  defineModule<Plain, Shape>()("test/module/Locale", {
    // @ts-expect-error make cannot capture any per-request service.
    make: Effect.map(RequestLocale, (locale) => ({ read: () => Effect.succeed(locale) })),
  }),
  defineModule<Plain, Shape>()("test/module/WrongSuccess", {
    // @ts-expect-error a number is not the declared string success.
    make: Effect.succeed({ read: (_actor: Actor) => Effect.succeed(1) }),
  }),
  defineModule<Plain, Shape>()("test/module/WrongFailure", {
    // @ts-expect-error BuildFailed is not the declared method failure.
    make: Effect.succeed({ read: (_actor: Actor) => Effect.fail(new BuildFailed()) }),
  }),
  defineModule<Plain, Shape>()("test/module/LeakedPort", {
    // @ts-expect-error implementation methods cannot leak service requirements.
    make: Effect.succeed({ read: (_actor: Actor) => Effect.map(Port, (port) => port.value) }),
  }),
];

it("checks the declared methods and preserves construction channels", () => {
  expect(typeof fixtures).toBe("function");
  expectTypeOf<LeakedPort>().not.toExtend<ModuleShape<LeakedPort>>();
  expectTypeOf<LeakedRequest>().not.toExtend<ModuleShape<LeakedRequest>>();
  expectTypeOf(Plain.layer).toEqualTypeOf<Layer.Layer<Plain, BuildFailed, Port>>();
  expectTypeOf(Configured.layer).returns.toEqualTypeOf<
    Layer.Layer<Configured, BuildFailed, Port>
  >();
});

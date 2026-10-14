import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { Actor, ActorId, defineModule, PerRequest } from "../index.ts";

class RequestActor extends Context.Service<RequestActor, Actor>()("test/module/RequestActor") {
  declare readonly [PerRequest]: typeof PerRequest;
}

it.effect("builds lazily, shares within one build, and rebuilds in another scope", () =>
  Effect.gen(function* () {
    let acquired = 0;
    let released = 0;
    class Counter extends defineModule<Counter, { readonly read: () => Effect.Effect<number> }>()(
      "test/module/Counter",
      {
        make: Effect.gen(function* () {
          const value = yield* Effect.acquireRelease(
            Effect.sync(() => ++acquired),
            () =>
              Effect.sync(() => {
                released++;
              }),
          );
          return { read: () => Effect.succeed(value) };
        }),
      },
    ) {}
    class First extends Context.Service<First, number>()("test/module/First") {}
    class Second extends Context.Service<Second, number>()("test/module/Second") {}
    const both = Layer.merge(
      Layer.effect(
        First,
        Counter.use((counter) => counter.read()),
      ).pipe(Layer.provide(Counter.layer)),
      Layer.effect(
        Second,
        Counter.use((counter) => counter.read()),
      ).pipe(Layer.provide(Counter.layer)),
    );
    expect(acquired).toBe(0);
    expect(Counter.id).toBe(Counter.key);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(both);
        expect(Context.get(context, First)).toBe(1);
        expect(Context.get(context, Second)).toBe(1);
        expect(acquired).toBe(1);
        expect(released).toBe(0);
      }),
    );
    expect(released).toBe(1);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(Counter.layer);
        expect(yield* Context.get(context, Counter).read()).toBe(2);
      }),
    );
    expect(acquired).toBe(2);
    expect(released).toBe(2);
  }),
);

it.effect("options and plain-data presets build lazily without a global cache", () =>
  Effect.gen(function* () {
    let made = 0;
    class Greeting extends defineModule<
      Greeting,
      {
        readonly greet: (actor: Actor) => Effect.Effect<string>;
      }
    >()("test/module/Greeting", {
      make: (options: { readonly prefix: string }) => {
        made++;
        return Effect.succeed({
          greet: (actor: Actor) => Effect.succeed(options.prefix + actor.id),
        });
      },
    }) {
      static readonly presets = { default: { prefix: "Hello " } };
    }
    const layer = Greeting.layer(Greeting.presets.default);
    expect(made).toBe(0);
    const a = Actor.make({ id: ActorId.make("a") });
    const b = Actor.make({ id: ActorId.make("b") });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer);
        const greeting = Context.get(context, Greeting);
        const request = Effect.gen(function* () {
          const actor = yield* RequestActor;
          return yield* greeting.greet(actor);
        });
        expect(yield* request.pipe(Effect.provideService(RequestActor, a))).toBe("Hello a");
        expect(yield* request.pipe(Effect.provideService(RequestActor, b))).toBe("Hello b");
        expect(yield* request.pipe(Effect.provideService(RequestActor, a))).toBe("Hello a");
        expect(made).toBe(1);
      }),
    );
    yield* Effect.scoped(Layer.build(layer));
    expect(made).toBe(2);
  }),
);

it.effect("releases resources when construction fails and keeps the typed error", () =>
  Effect.gen(function* () {
    let released = 0;
    class BuildFailed extends Schema.TaggedError<BuildFailed>()("BuildFailed", {}) {}
    class Broken extends defineModule<Broken, { readonly read: () => Effect.Effect<string> }>()(
      "test/module/Broken",
      {
        make: Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              released++;
            }),
          );
          return yield* Effect.fail(new BuildFailed());
        }),
      },
    ) {}
    const failure = yield* Effect.flip(Effect.scoped(Layer.build(Broken.layer)));
    expect(failure).toBeInstanceOf(BuildFailed);
    expect(released).toBe(1);
  }),
);

it.effect("decodes a minimal Actor", () =>
  Effect.gen(function* () {
    const actor = yield* Schema.decodeUnknownEffect(Actor)({ id: "user-1" });
    expect(actor).toEqual({ id: "user-1" });
    expect(Schema.is(Actor)({ id: "" })).toBe(false);
    expect(Schema.is(Actor)({ id: 1 })).toBe(false);
  }),
);

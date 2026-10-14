import { expect, it } from "@effect/vitest";
import { type Actor, ActorId, defineModule } from "@house-rules/domain";
import { Context, Effect, Schema } from "effect";
import { CurrentActor } from "../index.ts";

class Port extends Context.Service<Port, { readonly value: string }>()("test/actor/Port") {}

type Shape = { readonly read: (actor: Actor) => Effect.Effect<string> };

class Plain extends defineModule<Plain, Shape>()("test/actor/Plain", {
  make: Effect.map(Port, (port) => ({ read: (_actor: Actor) => Effect.succeed(port.value) })),
}) {}

const fixtures = () => [
  Plain.layer,
  defineModule<Plain, Shape>()("test/actor/CurrentActor", {
    // @ts-expect-error make cannot capture CurrentActor; a method takes the Actor instead.
    make: Effect.map(CurrentActor, (actor) => ({ read: () => Effect.succeed(actor.id) })),
  }),
  defineModule<Plain, Shape>()("test/actor/OptionsCurrentActor", {
    // @ts-expect-error options make cannot capture CurrentActor either.
    make: (_options: { readonly prefix: string }) =>
      Effect.map(CurrentActor, (actor) => ({ read: () => Effect.succeed(actor.id) })),
  }),
];

it("defineModule refuses a make that requires CurrentActor", () => {
  expect(typeof fixtures).toBe("function");
});

it.effect("yields the Actor directly from CurrentActor", () =>
  Effect.gen(function* () {
    const actor = { id: ActorId.make("user-1") };
    expect(yield* CurrentActor.pipe(Effect.provideService(CurrentActor, actor))).toEqual({
      id: "user-1",
    });
    expect(Schema.is(ActorId)("")).toBe(false);
  }),
);

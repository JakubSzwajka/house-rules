import { expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { type Capability, defineContract, implement } from "../index.ts";

class Greetings extends Context.Service<
  Greetings,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("test/Greetings") {
  static readonly layer = Layer.succeed(this, {
    greet: (name: string) => Effect.succeed(`Hello, ${name}`),
  });
}

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

class Unplanned extends Schema.TaggedError<Unplanned>()("Unplanned", {}) {}

const greetContract = defineContract("greet", {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  permission: "public",
  annotations: { readOnly: true },
});

const greet = implement(greetContract, ({ name }) =>
  Effect.gen(function* greetHandler() {
    if (name === "") {
      return yield* new NameIsEmpty();
    }
    const greetings = yield* Greetings;
    return yield* greetings.greet(name);
  }),
);

it.effect("a contract keeps what it was given and defaults the rest", () =>
  Effect.sync(() => {
    expect(greetContract.name).toBe("greet");
    expect(greetContract.annotations).toEqual({ readOnly: true, destructive: false });
  }),
);

it.effect("a contract with no annotations neither only reads nor destroys", () =>
  Effect.sync(() => {
    const contract = defineContract("forget", {
      description: "Forget a name.",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Void,
      failure: Schema.Never,
      permission: "public",
    });

    expect(contract.annotations).toEqual({ readOnly: false, destructive: false });
  }),
);

it.effect("the handler's type names the services, failure, and output it uses", () =>
  Effect.sync(() => {
    expectTypeOf(greet.handler).parameter(0).toEqualTypeOf<{ readonly name: string }>();
    expectTypeOf(greet.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty, Greetings>
    >();
  }),
);

it.effect("a handler may only fail and succeed with what the contract declares", () =>
  Effect.sync(() => {
    type GreetHandler = Capability<typeof greetContract, Greetings>["handler"];

    expectTypeOf<() => Effect.Effect<string, NameIsEmpty>>().toExtend<GreetHandler>();
    expectTypeOf<() => Effect.Effect<string, Unplanned>>().not.toExtend<GreetHandler>();
    expectTypeOf<() => Effect.Effect<number>>().not.toExtend<GreetHandler>();
  }),
);

it.effect("providing the layer removes the requirement", () =>
  Effect.gen(function* providedLayer() {
    const provided = greet.handler({ name: "Grace" }).pipe(Effect.provide(Greetings.layer));

    expectTypeOf(provided).toEqualTypeOf<Effect.Effect<string, NameIsEmpty>>();
    expect(yield* provided).toBe("Hello, Grace");
  }),
);

it.layer(Greetings.layer)("implement", (test) => {
  test.effect("runs the handler with the services its layer provides", () =>
    Effect.gen(function* runsHandler() {
      const result = yield* greet.handler({ name: "Ada" });

      expect(result).toBe("Hello, Ada");
    }),
  );

  test.effect("returns a failure the contract declares", () =>
    Effect.gen(function* declaredFailure() {
      const error = yield* Effect.flip(greet.handler({ name: "" }));

      expect(error._tag).toBe("NameIsEmpty");
    }),
  );
});

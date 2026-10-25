import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { defineOperation, errorKind } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import { bindOperation, type InnerFailure, Runtime } from "../index.ts";
import { bindFixture, runFixture } from "./execution-fixtures.ts";
class Greetings extends Context.Service<
  Greetings,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("test/Greetings") {
  static readonly layer = Layer.succeed(this, {
    greet: (name: string) => Effect.succeed(`Hello, ${name}`),
  });
}
class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {
  kind: errorKind("invalid"),
}) {}
class Unplanned extends Schema.TaggedError<Unplanned>()("Unplanned", {
  kind: errorKind("invalid"),
}) {}
const callable = defineOperation("greet", {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  permission: null,
  readOnly: true,
});
const feature = bindFixture(featureFixture(callable), ({ name }) =>
  Effect.gen(function* () {
    if (name === "") return yield* new NameIsEmpty();
    return yield* (yield* Greetings).greet(name);
  }),
);
it("the descriptor retains schemas and defaults the other flags", () => {
  expect(callable.name).toBe("greet");
  expect(callable.readOnly).toBe(true);
  expect(callable.destructive).toBe(false);
});
it("a callable with no flag declarations neither reads only nor destroys", () => {
  const plain = defineOperation("forget", {
    description: "Forget a name.",
    input: callable.input,
    output: Schema.Void,
    failure: Schema.Never,
    permission: null,
  });
  expect(plain.readOnly).toBe(false);
  expect(plain.destructive).toBe(false);
});
it("the binding constructor checks descriptor input, output and failures before erasure", () => {
  type Handler = Parameters<typeof bindOperation<typeof callable>>[1];
  expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{ readonly name: string }>();
  expectTypeOf<() => Effect.Effect<string, NameIsEmpty | InnerFailure>>().toExtend<Handler>();
  expectTypeOf<() => Effect.Effect<string, Unplanned>>().not.toExtend<Handler>();
  expectTypeOf<() => Effect.Effect<number>>().not.toExtend<Handler>();
});
it.effect("a binder captures a long-lived service while building its runtime layer", () =>
  Effect.gen(function* () {
    let captured = 0;
    const layer = Layer.effect(
      Runtime,
      Effect.gen(function* () {
        const greetings = yield* Greetings;
        captured += 1;
        return yield* RuntimeFixture.make({
          bindings: [bindOperation(callable, ({ name }) => greetings.greet(name))],
          features: [feature],
          ways: [],
        });
      }),
    ).pipe(Layer.provide(Greetings.layer));
    const runtime = yield* Effect.service(Runtime).pipe(Effect.provide(layer));
    expect(typeof runtime.run).toBe("function");
    expect(captured).toBe(1);
  }),
);
it.effect("providing the module layer removes its capture requirement", () =>
  Effect.gen(function* () {
    expect(
      yield* runFixture(feature, { name: "Grace" }).pipe(Effect.provide(Greetings.layer)),
    ).toBe("Hello, Grace");
  }),
);
it.layer(Greetings.layer)("a bound feature", (test) => {
  test.effect("uses the captured module service", () =>
    Effect.gen(function* () {
      expect(yield* runFixture(feature, { name: "Ada" })).toBe("Hello, Ada");
    }),
  );
  test.effect("returns its declared kinded failure", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(runFixture(feature, { name: "" })))._tag).toBe("NameIsEmpty");
    }),
  );
});

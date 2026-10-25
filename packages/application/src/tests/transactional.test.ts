import { featureFixture } from "./feature-fixtures.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  defineOperation,
  errorKind,
  memoryUnitOfWork,
  NoOpenUnit,
  UnitOfWork,
  UnitOfWorkFailed,
} from "@house-rules/domain";
import { Cause, Effect, Exit, Schema } from "effect";
import { type FeatureFailure, type FeatureRequirements } from "../index.ts";
import { bindFixture, runFixture } from "./execution-fixtures.ts";
class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {
  kind: errorKind("invalid"),
}) {}
const base = {
  description: "Greet someone.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  permission: "greetings:send",
} as const;
const greet = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);
const plain = bindFixture(featureFixture(defineOperation("plain", base)), greet);
const atomic = bindFixture(
  featureFixture(defineOperation("atomic", { ...base, transactional: true })),
  greet,
);
const write = ({ name }: { readonly name: string }) =>
  UnitOfWork.required.pipe(Effect.andThen(greet({ name })));
const atomicWrite = bindFixture(
  featureFixture(defineOperation("atomic_write", { ...base, transactional: true })),
  write,
);
const redundant = bindFixture(
  featureFixture(
    defineOperation("redundant", {
      ...base,
      failure: Schema.Union([NameIsEmpty, NoOpenUnit]),
      transactional: true,
    }),
  ),
  write,
);
const plainWrite = bindFixture(
  featureFixture(
    defineOperation("plain_write", { ...base, failure: Schema.Union([NameIsEmpty, NoOpenUnit]) }),
  ),
  write,
);
it("transactional defaults to false with no unit slot or unit-open failure", () => {
  expect(plain.transactional).toBe(false);
  expectTypeOf(plain.transactional).toEqualTypeOf<false>();
  expectTypeOf<Extract<FeatureRequirements<typeof plain>, UnitOfWork>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<FeatureFailure<typeof plain>, UnitOfWorkFailed>>().toEqualTypeOf<never>();
});
it("transactional feature failures exclude NoOpenUnit even when its callable declared it", () => {
  expectTypeOf<Extract<FeatureFailure<typeof atomicWrite>, NoOpenUnit>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<FeatureFailure<typeof redundant>, NoOpenUnit>>().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<FeatureFailure<typeof plainWrite>, NoOpenUnit>
  >().toEqualTypeOf<NoOpenUnit>();
});
it("a true transaction flag adds UnitOfWork and its kinded failure", () => {
  expect(atomic.transactional).toBe(true);
  expectTypeOf<
    Extract<FeatureRequirements<typeof atomic>, UnitOfWork>
  >().toEqualTypeOf<UnitOfWork>();
  expectTypeOf<
    Extract<FeatureFailure<typeof atomic>, UnitOfWorkFailed>
  >().toEqualTypeOf<UnitOfWorkFailed>();
});
it.effect("a transactional write joins its feature unit", () =>
  Effect.gen(function* () {
    expect(
      yield* runFixture(atomicWrite, { name: "Ada" }).pipe(Effect.provide(memoryUnitOfWork)),
    ).toBe("Hello, Ada");
    expect(
      yield* runFixture(redundant, { name: "Ada" }).pipe(Effect.provide(memoryUnitOfWork)),
    ).toBe("Hello, Ada");
    expect((yield* Effect.flip(runFixture(plainWrite, { name: "Ada" })))._tag).toBe("NoOpenUnit");
  }),
);
it.effect("unexpected NoOpenUnit inside an atomic feature is a defect", () =>
  Effect.gen(function* () {
    const broken = bindFixture(
      featureFixture(defineOperation("broken_unit", { ...base, transactional: true })),
      () => Effect.fail(new NoOpenUnit()),
    );
    const exit = yield* Effect.exit(
      runFixture(broken, { name: "Ada" }).pipe(Effect.provide(memoryUnitOfWork)),
    );
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }),
);

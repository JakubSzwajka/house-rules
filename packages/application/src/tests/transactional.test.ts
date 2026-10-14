import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { NoOpenUnit, UnitOfWork, UnitOfWorkFailed } from "@house-rules/domain";
import {
  defineContract,
  type Forbidden,
  failureSchemaOf,
  type Grant,
  implement,
} from "../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  permission: "greetings:send",
} as const;

const greetHandler = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

const plainGreeting = implement(defineContract("plain_greeting", base), greetHandler);

const transactionalGreeting = implement(
  defineContract("transactional_greeting", { ...base, transactional: true }),
  greetHandler,
);

const writeHandler = ({ name }: { readonly name: string }) =>
  UnitOfWork.required.pipe(Effect.andThen(greetHandler({ name })));
const transactionalWrite = implement(
  defineContract("transactional_write", { ...base, transactional: true }),
  writeHandler,
);
const redundantWrite = implement(
  defineContract("redundant_write", {
    ...base,
    failure: Schema.Union([NameIsEmpty, NoOpenUnit]),
    transactional: true,
  }),
  writeHandler,
);
const plainWrite = implement(
  defineContract("plain_write", { ...base, failure: Schema.Union([NameIsEmpty, NoOpenUnit]) }),
  writeHandler,
);

it.effect("transactional defaults to false and adds nothing", () =>
  Effect.sync(() => {
    expect(plainGreeting.contract.transactional).toBe(false);
    expectTypeOf(plainGreeting.contract.transactional).toEqualTypeOf<false>();
    expectTypeOf(plainGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden, Grant>
    >();
    const failure = failureSchemaOf(plainGreeting.contract);
    expect(Schema.is(failure)(new UnitOfWorkFailed({ reason: "commit" }))).toBe(false);
  }),
);

it.effect("transactional handlers exclude NoOpenUnit; plain handlers keep it", () =>
  Effect.sync(() => {
    expectTypeOf(transactionalWrite.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | UnitOfWorkFailed, Grant | UnitOfWork>
    >();
    expectTypeOf(redundantWrite.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | UnitOfWorkFailed, Grant | UnitOfWork>
    >();
    expectTypeOf(plainWrite.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | NoOpenUnit | Forbidden, Grant>
    >();
  }),
);

it.effect("transactional: true adds UnitOfWork and UnitOfWorkFailed", () =>
  Effect.sync(() => {
    expect(transactionalGreeting.contract.transactional).toBe(true);
    expectTypeOf(transactionalGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | UnitOfWorkFailed, Grant | UnitOfWork>
    >();
    const failure = failureSchemaOf(transactionalGreeting.contract);
    expect(Schema.is(failure)(new UnitOfWorkFailed({ reason: "commit" }))).toBe(true);
  }),
);

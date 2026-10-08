import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  defineContract,
  type Forbidden,
  failureSchemaOf,
  type Grant,
  implement,
  type UnitOfWork,
  UnitOfWorkFailed,
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

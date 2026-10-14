import { expectTypeOf, it } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork, type UnitOfWorkFailed } from "@house-rules/domain";
import { defineContract, implement } from "@house-rules/application";
import { Effect, Schema } from "effect";

const base = {
  description: "Check the transaction boundary's consumer error type.",
  input: Schema.Struct({}),
  output: Schema.Void,
  failure: NoOpenUnit,
  permission: "public",
} as const;

const transactional = implement(
  defineContract("transactional_type_probe", { ...base, transactional: true }),
  () => UnitOfWork.required,
);
const plain = implement(defineContract("plain_type_probe", base), () => UnitOfWork.required);

it("consumers must delete outer NoOpenUnit catches on transactional handler results", () => {
  const result = transactional.handler({});
  expectTypeOf(result).toEqualTypeOf<Effect.Effect<void, UnitOfWorkFailed, UnitOfWork>>();
  const invalid = result.pipe(
    // @ts-expect-error transactional handler results no longer fail with NoOpenUnit.
    Effect.catchTag("NoOpenUnit", () => Effect.void),
  );
  expectTypeOf(invalid).toBeObject();
  const recovered = plain.handler({}).pipe(Effect.catchTag("NoOpenUnit", () => Effect.void));
  expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<void>>();
});

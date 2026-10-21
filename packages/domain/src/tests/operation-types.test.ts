import { expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import { asSystem, defineOperation, errorKind, NoInput, type Targets } from "../index.ts";

class Kinded extends Schema.TaggedError<Kinded>()("Kinded", { kind: errorKind("invalid") }) {}
class Unkinded extends Schema.TaggedError<Unkinded>()("Unkinded", {}) {}
const read = defineOperation("read", {
  description: "Read",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  permission: null,
  flags: { readOnly: true },
});
const root = defineOperation("root", { ...read, edges: [asSystem(read, "background")] });
const invalid = () => {
  // @ts-expect-error Empty literal reasons are not allowed.
  asSystem(read, "");
  // @ts-expect-error An unkinded error is not a callable failure.
  defineOperation("bad", { ...read, failure: Unkinded });
  // @ts-expect-error Every member of a union must have a kind.
  defineOperation("bad_union", { ...read, failure: Schema.Union([Kinded, Unkinded]) });
};

it("keeps omitted flags literal in inline nested edges", () => {
  const nested = defineOperation("outer", {
    ...read,
    edges: [
      defineOperation("inline", {
        description: "Inline defaults",
        input: NoInput,
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
        edges: [
          asSystem(
            defineOperation("inline_system", {
              description: "System defaults",
              input: NoInput,
              output: Schema.String,
              failure: Schema.Never,
              permission: null,
              readOnly: true,
            }),
            "background",
          ),
        ],
      }),
    ],
  });
  const inline = nested.edges[0];
  expectTypeOf(inline.readOnly).toEqualTypeOf<false>();
  expectTypeOf(inline.destructive).toEqualTypeOf<false>();
  expectTypeOf(inline.transactional).toEqualTypeOf<false>();
  expectTypeOf(inline.needsApproval).toEqualTypeOf<false>();
  const system = inline.edges[0].target;
  expectTypeOf(system.readOnly).toEqualTypeOf<true>();
  expectTypeOf(system.destructive).toEqualTypeOf<false>();
  expectTypeOf(system.transactional).toEqualTypeOf<false>();
  expectTypeOf(system.needsApproval).toEqualTypeOf<false>();
  expectTypeOf(system.edges).toEqualTypeOf<readonly []>();
});

it("keeps literal flags and edge targets", () => {
  expect(typeof invalid).toBe("function");
  expectTypeOf(read.readOnly).toEqualTypeOf<true>();
  expectTypeOf(read.transactional).toEqualTypeOf<false>();
  expectTypeOf<Targets<typeof root>>().toEqualTypeOf<typeof read>();
});

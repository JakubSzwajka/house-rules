import { featureFixture } from "./feature-fixtures.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  type AnyCallable,
  defineOperation,
  errorKind,
  NoInput,
  type UnitOfWork,
} from "@house-rules/domain";
import { Context, Effect, Schema } from "effect";
import {
  type AnyFeature,
  Approval,
  bindOperation,
  CallerContext,
  CurrentActor,
  type FeatureFlags,
  type FeatureRequirements,
  type InnerFailure,
  type ScopedCall,
} from "../index.ts";

const read = defineOperation("read", {
  description: "Read",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
});
const write = defineOperation("write", {
  description: "Write",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: "items:write",
  transactional: true,
  needsApproval: true,
  destructive: true,
});
const root = defineOperation("root", {
  description: "Root",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
  edges: [write],
  transactional: false,
});
const readEntry = featureFixture(read);
const systemEntry = featureFixture(read, {
  start: { kind: "system", reason: "background", startedBy: "schedule:test" },
});
const wide = (callable: AnyCallable) => featureFixture(callable);
class Port extends Context.Service<Port, string>()("test/type/Port") {}
class Unplanned extends Schema.TaggedError<Unplanned>()("Unplanned", {
  kind: errorKind("invalid"),
}) {}
const unplanned = () => Effect.fail(new Unplanned());
const negative = (scope: ScopedCall<typeof root>, erased: AnyFeature) => {
  // @ts-expect-error Only declared targets can be called.
  const undeclared = scope(read, { id: "1" });
  // @ts-expect-error A binding cannot return an undeclared success type.
  bindOperation(read, () => Effect.succeed(1));
  // @ts-expect-error Erased flags do not prove a concrete read-only feature.
  const concrete: typeof readEntry = erased;
  // @ts-expect-error A read-only feature has no UOW requirement.
  const unit: Extract<FeatureRequirements<typeof readEntry>, UnitOfWork> = {} as UnitOfWork;
  // @ts-expect-error A system feature has no CurrentActor requirement.
  const actor: Extract<FeatureRequirements<typeof systemEntry>, CurrentActor> = {} as CurrentActor;
  return [undeclared, concrete, unit, actor];
};

it("keeps concrete flags and erases only the AnyFeature container", () => {
  const inline = featureFixture(
    defineOperation("inline_root", {
      ...read,
      edges: [
        defineOperation("inline_read", {
          description: "Inline read",
          input: NoInput,
          output: Schema.Void,
          failure: Schema.Never,
          permission: null,
          readOnly: true,
        }),
      ],
    }),
  );
  expectTypeOf(inline.readOnly).toEqualTypeOf<true>();
  expectTypeOf(inline.transactional).toEqualTypeOf<false>();
  expectTypeOf(inline.needsApproval).toEqualTypeOf<false>();
  expectTypeOf(inline.destructive).toEqualTypeOf<false>();
  expectTypeOf<
    Extract<FeatureRequirements<typeof inline>, UnitOfWork | Approval>
  >().toEqualTypeOf<never>();
  const erased: AnyFeature = readEntry;
  expect(erased).toBe(readEntry);
  expect(typeof negative).toBe("function");
  expectTypeOf<() => Effect.Effect<string, never, Port>>().not.toExtend<
    Parameters<typeof bindOperation<typeof read>>[1]
  >();
  expectTypeOf<() => Effect.Effect<string, never, CurrentActor>>().not.toExtend<
    Parameters<typeof bindOperation<typeof read>>[1]
  >();
  expectTypeOf<typeof unplanned>().not.toExtend<Parameters<typeof bindOperation<typeof read>>[1]>();
  expectTypeOf<FeatureFlags<typeof read>["transactional"]>().toEqualTypeOf<false>();
  expectTypeOf<FeatureFlags<typeof root>["transactional"]>().toEqualTypeOf<true>();
  expectTypeOf<
    Extract<FeatureRequirements<ReturnType<typeof wide>>, UnitOfWork>
  >().toEqualTypeOf<UnitOfWork>();
  expectTypeOf<
    Extract<FeatureRequirements<ReturnType<typeof wide>>, Approval>
  >().toEqualTypeOf<Approval>();
  expectTypeOf<Extract<FeatureRequirements<typeof readEntry>, UnitOfWork>>().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<FeatureRequirements<typeof systemEntry>, CurrentActor>
  >().toEqualTypeOf<never>();
  expectTypeOf<ReturnType<ScopedCall<typeof root>>>().toEqualTypeOf<
    Effect.Effect<void, InnerFailure>
  >();
  bindOperation(read, () => Effect.map(CallerContext, () => "ok"));
});

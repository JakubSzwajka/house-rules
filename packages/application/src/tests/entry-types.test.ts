import { expect, expectTypeOf, it } from "@effect/vitest";
import { type AnyNode, defineNode, errorKind, NoInput, type UnitOfWork } from "@house-rules/domain";
import { Context, Effect, Schema } from "effect";
import {
  type AnyEntry,
  Approval,
  bindNode,
  CallerContext,
  CurrentActor,
  defineEntry,
  type EntryFlags,
  type EntryRequirements,
  type InnerFailure,
  type ScopedCall,
} from "../index.ts";

const read = defineNode("read", {
  description: "Read",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
});
const write = defineNode("write", {
  description: "Write",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: "items:write",
  transactional: true,
  needsApproval: true,
  destructive: true,
});
const root = defineNode("root", {
  description: "Root",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
  edges: [write],
  transactional: false,
});
const readEntry = defineEntry(read);
const systemEntry = defineEntry(read, {
  start: { kind: "system", reason: "background", startedBy: "schedule:test" },
});
const wide = (node: AnyNode) => defineEntry(node);
class Port extends Context.Service<Port, string>()("test/type/Port") {}
class Unplanned extends Schema.TaggedError<Unplanned>()("Unplanned", {
  kind: errorKind("invalid"),
}) {}
const unplanned = () => Effect.fail(new Unplanned());
const negative = (scope: ScopedCall<typeof root>, erased: AnyEntry) => {
  // @ts-expect-error Only declared targets can be called.
  const undeclared = scope(read, { id: "1" });
  // @ts-expect-error A binding cannot return an undeclared success type.
  bindNode(read, () => Effect.succeed(1));
  // @ts-expect-error Erased flags do not prove a concrete read-only entry.
  const concrete: typeof readEntry = erased;
  // @ts-expect-error A read-only entry has no UOW requirement.
  const unit: Extract<EntryRequirements<typeof readEntry>, UnitOfWork> = {} as UnitOfWork;
  // @ts-expect-error A system entry has no CurrentActor requirement.
  const actor: Extract<EntryRequirements<typeof systemEntry>, CurrentActor> = {} as CurrentActor;
  return [undeclared, concrete, unit, actor];
};

it("keeps concrete flags and erases only the AnyEntry container", () => {
  const inline = defineEntry(
    defineNode("inline_root", {
      ...read,
      edges: [
        defineNode("inline_read", {
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
    Extract<EntryRequirements<typeof inline>, UnitOfWork | Approval>
  >().toEqualTypeOf<never>();
  const erased: AnyEntry = readEntry;
  expect(erased).toBe(readEntry);
  expect(typeof negative).toBe("function");
  expectTypeOf<() => Effect.Effect<string, never, Port>>().not.toExtend<
    Parameters<typeof bindNode<typeof read>>[1]
  >();
  expectTypeOf<() => Effect.Effect<string, never, CurrentActor>>().not.toExtend<
    Parameters<typeof bindNode<typeof read>>[1]
  >();
  expectTypeOf<typeof unplanned>().not.toExtend<Parameters<typeof bindNode<typeof read>>[1]>();
  expectTypeOf<EntryFlags<typeof read>["transactional"]>().toEqualTypeOf<false>();
  expectTypeOf<EntryFlags<typeof root>["transactional"]>().toEqualTypeOf<true>();
  expectTypeOf<
    Extract<EntryRequirements<ReturnType<typeof wide>>, UnitOfWork>
  >().toEqualTypeOf<UnitOfWork>();
  expectTypeOf<
    Extract<EntryRequirements<ReturnType<typeof wide>>, Approval>
  >().toEqualTypeOf<Approval>();
  expectTypeOf<Extract<EntryRequirements<typeof readEntry>, UnitOfWork>>().toEqualTypeOf<never>();
  expectTypeOf<
    Extract<EntryRequirements<typeof systemEntry>, CurrentActor>
  >().toEqualTypeOf<never>();
  expectTypeOf<ReturnType<ScopedCall<typeof root>>>().toEqualTypeOf<
    Effect.Effect<void, InnerFailure>
  >();
  bindNode(read, () => Effect.map(CallerContext, () => "ok"));
});

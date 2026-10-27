import { expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  WorkItem,
  WorkItemFailure,
  WorkItemFilters,
  WorkItemList,
  WorkItemPermissions,
  WorkItemRef,
  WorkItemsCallerDenied,
  WorkItemsOperations,
  WorkItemTree,
} from "../contract.js";

const baseline = {
  get: {
    description: "Read one visible work item.",
    input: Schema.Struct({ id: Schema.NonEmptyString }),
    output: WorkItem,
    failure: WorkItemFailure,
    permission: WorkItemPermissions.read,
  },
  getForSystem: {
    description: "Read one work item as the system without person access checks.",
    input: Schema.Struct({ id: Schema.NonEmptyString }),
    output: WorkItem,
    failure: Schema.Union([WorkItemFailure, WorkItemsCallerDenied]),
    permission: WorkItemPermissions.systemRead,
  },
  list: {
    description: "List visible work items with filters and an exclusive cursor.",
    input: WorkItemFilters,
    output: WorkItemList,
    failure: WorkItemFailure,
    permission: WorkItemPermissions.read,
  },
  tree: {
    description: "Read a container's work item hierarchy.",
    input: Schema.Struct({ container: Schema.NullOr(WorkItemRef) }),
    output: Schema.Array(WorkItemTree),
    failure: WorkItemFailure,
    permission: WorkItemPermissions.read,
  },
} as const;

for (const name of ["get", "getForSystem", "list", "tree"] as const) {
  it(`preserves the public ${name} descriptor metadata`, () => {
    const { input, output, failure, ...metadata } = WorkItemsOperations[name];
    const expected = baseline[name];
    expect(metadata).toEqual({
      name: `WorkItems.${name}`,
      kind: "operation",
      description: expected.description,
      permission: expected.permission,
      readOnly: true,
      destructive: false,
      transactional: false,
      needsApproval: false,
      edges: [],
    });
    expect(input.ast).toEqual(expected.input.ast);
    expect(output.ast).toEqual(expected.output.ast);
    expect(failure.ast).toEqual(expected.failure.ast);
    expect(Object.isFrozen(WorkItemsOperations[name])).toBe(true);
    expect(Object.isFrozen(WorkItemsOperations[name].edges)).toBe(true);
    expectTypeOf(WorkItemsOperations[name].readOnly).toEqualTypeOf<true>();
    expectTypeOf(WorkItemsOperations[name].transactional).toEqualTypeOf<false>();
    expectTypeOf(WorkItemsOperations[name].destructive).toEqualTypeOf<false>();
    expectTypeOf(WorkItemsOperations[name].needsApproval).toEqualTypeOf<false>();
    expectTypeOf(WorkItemsOperations[name].edges).toEqualTypeOf<readonly []>();
  });
}

it("keeps shared schema identities and the system failure override", () => {
  expect(WorkItemsOperations.get.input).toBe(WorkItemsOperations.getForSystem.input);
  expect(WorkItemsOperations.get.output).toBe(WorkItem);
  expect(WorkItemsOperations.getForSystem.output).toBe(WorkItem);
  expect(WorkItemsOperations.list.input).toBe(WorkItemFilters);
  expect(WorkItemsOperations.list.output).toBe(WorkItemList);
  for (const name of ["get", "list", "tree"] as const) {
    expect(WorkItemsOperations[name].failure).toBe(WorkItemFailure);
  }
  expect(WorkItemsOperations.getForSystem.failure.members).toEqual([
    WorkItemFailure,
    WorkItemsCallerDenied,
  ]);
});

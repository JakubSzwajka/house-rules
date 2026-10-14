import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect } from "effect";
import { definePolicy, type Policy, type StatefulPolicy } from "../index.ts";

const tripPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
});

it.effect("allows answers whether a relation carries a permission", () =>
  Effect.sync(() => {
    expect(tripPolicy.allows("owner", "trips:delete")).toBe(true);
    expect(tripPolicy.allows("shared", "trips:write")).toBe(true);
    expect(tripPolicy.allows("shared", "trips:share")).toBe(false);
  }),
);

it.effect("the table lists every relation against every permission", () =>
  Effect.sync(() => {
    expect(tripPolicy.permissions).toEqual([
      "trips:read",
      "trips:write",
      "trips:delete",
      "trips:share",
    ]);
    expect(tripPolicy.table()).toEqual({
      owner: {
        "trips:read": true,
        "trips:write": true,
        "trips:delete": true,
        "trips:share": true,
      },
      shared: {
        "trips:read": true,
        "trips:write": true,
        "trips:delete": false,
        "trips:share": false,
      },
    });
  }),
);

it.effect("the types know the relations and permissions of the policy", () =>
  Effect.sync(() => {
    expectTypeOf(tripPolicy.allows).parameter(0).toEqualTypeOf<"owner" | "shared">();
    expectTypeOf(tripPolicy.allows)
      .parameter(1)
      .toEqualTypeOf<"trips:read" | "trips:write" | "trips:delete" | "trips:share">();
  }),
);

const statefulPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
}).withStates({
  active: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  frozen: ["trips:read", "trips:delete"],
});

it.effect("a relation-only policy is unchanged by withStates existing", () =>
  Effect.sync(() => {
    expect(tripPolicy.allows("owner", "trips:share")).toBe(true);
    expect(Object.keys(tripPolicy.table())).toEqual(["owner", "shared"]);
    expect(tripPolicy.table().shared["trips:write"]).toBe(true);
  }),
);

it.effect("a hand-written four-field Policy still type-checks", () =>
  Effect.sync(() => {
    const handWritten: Policy<"owner", "trips:read"> = {
      relations: { owner: ["trips:read"] },
      permissions: ["trips:read"],
      allows: (relation, permission) => relation === "owner" && permission === "trips:read",
      table: () => ({ owner: { "trips:read": true } }),
    };
    expect(handWritten.allows("owner", "trips:read")).toBe(true);
    // definePolicy's result is still assignable to the plain Policy type.
    const plain: Policy<
      "owner" | "shared",
      "trips:read" | "trips:write" | "trips:delete" | "trips:share"
    > = tripPolicy;
    expect(plain.permissions).toEqual(tripPolicy.permissions);
  }),
);

it.effect("a stateful policy allows only what both the relation and the state allow", () =>
  Effect.sync(() => {
    expect(statefulPolicy.allows("owner", "active", "trips:write")).toBe(true);
    expect(statefulPolicy.allows("owner", "frozen", "trips:write")).toBe(false);
    expect(statefulPolicy.allows("owner", "frozen", "trips:delete")).toBe(true);
    expect(statefulPolicy.allows("shared", "active", "trips:delete")).toBe(false);
    expect(statefulPolicy.allows("shared", "frozen", "trips:delete")).toBe(false);
    expect(statefulPolicy.allows("shared", "frozen", "trips:read")).toBe(true);
  }),
);

it.effect("the stateful table covers every relation, state and permission", () =>
  Effect.sync(() => {
    const table = statefulPolicy.table();
    expect(Object.keys(table)).toEqual(["owner", "shared"]);
    for (const relation of ["owner", "shared"] as const) {
      expect(Object.keys(table[relation])).toEqual(["active", "frozen"]);
      for (const state of ["active", "frozen"] as const) {
        expect(Object.keys(table[relation][state])).toEqual(statefulPolicy.permissions);
        for (const permission of statefulPolicy.permissions) {
          expect(table[relation][state][permission]).toBe(
            statefulPolicy.allows(relation, state, permission),
          );
        }
      }
    }
    expect(table.owner.frozen).toEqual({
      "trips:read": true,
      "trips:write": false,
      "trips:delete": true,
      "trips:share": false,
    });
    expect(table.shared.active).toEqual({
      "trips:read": true,
      "trips:write": true,
      "trips:delete": false,
      "trips:share": false,
    });
  }),
);

it.effect("the stateful types keep the literal relations, states and permissions", () =>
  Effect.sync(() => {
    expectTypeOf(statefulPolicy.allows).parameter(0).toEqualTypeOf<"owner" | "shared">();
    expectTypeOf(statefulPolicy.allows).parameter(1).toEqualTypeOf<"active" | "frozen">();
    expectTypeOf(statefulPolicy.allows)
      .parameter(2)
      .toEqualTypeOf<"trips:read" | "trips:write" | "trips:delete" | "trips:share">();
    expectTypeOf(statefulPolicy).toEqualTypeOf<
      StatefulPolicy<
        "owner" | "shared",
        "active" | "frozen",
        "trips:read" | "trips:write" | "trips:delete" | "trips:share"
      >
    >();
  }),
);

it.effect("an unknown state or permission does not compile", () =>
  Effect.sync(() => {
    // Type-only checks: the closure is never called.
    const never = () => {
      // @ts-expect-error "archived" is not a state of the policy
      statefulPolicy.allows("owner", "archived", "trips:read");
      // @ts-expect-error "trips:fly" is not a permission of the policy
      statefulPolicy.allows("owner", "active", "trips:fly");
      // @ts-expect-error "trips:fly" is not a permission of the relations
      tripPolicy.withStates({ active: ["trips:fly"] });
    };
    expect(never).toBeTypeOf("function");
  }),
);

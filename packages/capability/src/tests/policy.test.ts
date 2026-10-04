import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect } from "effect";
import { definePolicy } from "../index.ts";

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

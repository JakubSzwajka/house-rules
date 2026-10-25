import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { validatePlan } from "../../index.ts";

it.effect("feature targets fail with exact edge paths for plain and system edges", () =>
  Effect.gen(function* () {
    for (const edge of ["child", { target: "child", reason: "background" }]) {
      const error = yield* validatePlan({
        modules: [],
        features: [
          { name: "root", permission: null, edges: [edge] },
          { name: "child", permission: null },
        ],
        ways: [],
      }).pipe(Effect.flip);
      expect(error._tag).toBe("PlanInvalid");
      expect(error.issues).toEqual([
        {
          path: "features[0].edges[0]",
          reason: "Edge must target an operation: root -> child",
        },
      ]);
    }
  }),
);

it.effect("operation edges cannot hide a feature target in new maps", () =>
  Effect.gen(function* () {
    const error = yield* validatePlan({
      modules: [
        {
          name: "store",
          service: "test/Store",
          kind: "package",
          operations: [{ name: "root", permission: null, edges: ["child"] }],
        },
      ],
      features: [{ name: "child", permission: null }],
      ways: [],
    }).pipe(Effect.flip);
    expect(error.issues).toEqual([
      {
        path: "modules[0].operations[0].edges[0]",
        reason: "Edge must target an operation: root -> child",
      },
    ]);
  }),
);

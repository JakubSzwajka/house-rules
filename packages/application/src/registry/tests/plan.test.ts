import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { appMap, Plan, renderMap, validatePlan } from "../../index.ts";
import { app, plan } from "./plan-fixtures.ts";

it.effect("a plan derives the same map as the built app", () =>
  Effect.gen(function* () {
    const built = app();
    try {
      const actual = yield* appMap(built);
      const planned = yield* validatePlan(plan);
      for (const format of ["json", "text", "mermaid"] as const)
        expect(renderMap(planned, format)).toBe(renderMap(actual, format));
      const saveFeature = planned.features.find((feature) => feature.name === "save_item");
      expect(saveFeature?.flags).toEqual({
        readOnly: false,
        destructive: false,
        transactional: true,
        needsApproval: false,
      });
      expect(saveFeature?.closures).toEqual({
        person: ["app:use", "items:read", "items:write"],
        system: ["audit:write"],
      });
      expect(planned.features.find((feature) => feature.name === "list_items")?.ways).toEqual([
        "mcp",
        "web",
      ]);
    } finally {
      yield* Effect.promise(built.dispose);
    }
  }),
);

it.effect("a JSON plan decodes with the Plan schema and keeps source facts", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Plan)(
      JSON.parse(
        JSON.stringify({
          ...plan,
          modules: plan.modules.map((module) => ({ ...module, path: `packages/${module.name}` })),
          features: plan.features.map((feature) => ({
            ...feature,
            path: `src/${feature.name}.ts`,
          })),
          ways: plan.ways.map((way) => ({ ...way, source: `src/ways-in/${way.name}.ts` })),
        }),
      ),
    );
    const snapshot = yield* validatePlan(decoded);
    expect(snapshot.modules.find((module) => module.name === "views")?.path).toBe("packages/views");
    expect(snapshot.features.find((feature) => feature.name === "sign_up")?.path).toBe(
      "src/sign_up.ts",
    );
    expect(snapshot.ways.find((way) => way.name === "web")?.source).toBe("src/ways-in/web.ts");
    expect(renderMap(snapshot, "text")).toContain(
      "sign_up  system (public sign-up)  src/sign_up.ts",
    );
    const bad = yield* Schema.decodeUnknownEffect(Plan)({
      ...plan,
      ways: [{ name: "x", protocol: "ftp", features: [] }],
    }).pipe(Effect.flip);
    expect(String(bad)).toContain("ways");
  }),
);

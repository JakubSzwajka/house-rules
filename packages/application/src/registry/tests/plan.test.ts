import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { appMap, composition, May, Plan, renderMap, validatePlan } from "../../index.ts";
import { app, modules, plan, ways } from "./plan-fixtures.ts";

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
      expect(planned.plugs?.map((plug) => [plug.name, plug.fills, plug.ways ?? []])).toEqual([
        ["May.fixed", "May", []],
        ["Mean.allow", "Mean", ["changed", "nightly"]],
        ["Mean.elicitation", "Mean", ["mcp"]],
        ["Mean.no", "Mean", ["web"]],
        ["hook:changed", "test/plan/Slot", ["changed"]],
        ["test.who", "Who", ["mcp", "web"]],
      ]);
      expect(renderMap(actual, "text")).toContain(
        "\nPLUGS\n May.fixed  fills May  @house-rules/application\n" +
          " Mean.allow  fills Mean on changed, nightly  @house-rules/application\n",
      );
      expect(renderMap(actual, "text")).toContain(
        " hook:changed  fills test/plan/Slot on changed\n test.who  fills Who on mcp, web\n",
      );
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

it.effect("appMap fails closed on a declared plug that names no real way or slot", () =>
  Effect.gen(function* () {
    const built = composition({
      modules: { ...modules, plugs: [{ name: "x.who", fills: "Who", ways: ["nightly"] }] },
      features: app().features,
      ways,
      may: Effect.succeed(May.fixed([])),
      system: ["audit:write", "items:read", "items:remove", "items:write"],
    });
    try {
      const error = yield* appMap(built).pipe(Effect.flip);
      expect(error._tag).toBe("GraphInvalid");
      expect(error.message).toContain(
        "plugs[0].ways[0]: x.who fills Who on nightly, which is not an HTTP or MCP way",
      );
    } finally {
      yield* Effect.promise(built.dispose);
    }
  }),
);

import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { diffMaps, Plan, renderMap, validatePlan } from "../../index.ts";

const raw = {
  modules: [
    {
      name: "store",
      service: "test/store",
      kind: "package",
      role: "process",
      operations: [
        { name: "read", permission: "items:read", readOnly: true },
        { name: "write", permission: "items:write" },
      ],
    },
  ],
  features: [{ name: "query", kind: "read-model", permission: null, edges: ["read"] }],
  ways: [{ name: "web", protocol: "http", path: "/", features: ["query"] }],
};

it.effect(
  "plans and every rendering retain entry kind, and diffs detect only the kind change",
  () =>
    Effect.gen(function* () {
      const plan = yield* Schema.decodeUnknownEffect(Plan)(raw);
      const query = yield* validatePlan(plan);
      expect(query.features[0]?.kind).toBe("read-model");
      for (const format of ["text", "json", "mermaid", "html"] as const)
        expect(renderMap(query, format)).toContain("read-model");
      const command = yield* validatePlan({
        ...plan,
        features: plan.features.map((entry) => ({ ...entry, kind: "feature", readOnly: true })),
      });
      expect(diffMaps(command, query).features.changed[0]?.fields).toEqual([
        { field: "kind", before: "feature", after: "read-model" },
      ]);
      const legacy = yield* validatePlan({
        ...plan,
        features: [{ name: "query", permission: null, readOnly: true, edges: ["read"] }],
      });
      expect(legacy.features[0]?.kind).toBe("feature");
    }),
);

it.effect(
  "plans reject read-to-write and entry-to-entry targets, including process/system paths",
  () =>
    Effect.gen(function* () {
      for (const system of [false, true]) {
        const edge = system ? { target: "write", reason: "probe" } : "write";
        const bad = {
          ...raw,
          modules: [
            {
              ...raw.modules[0],
              operations: [
                { name: "read", permission: null, readOnly: true, edges: [edge] },
                { name: "write", permission: null },
              ],
            },
          ],
        };
        const error = yield* Effect.flip(
          validatePlan(yield* Schema.decodeUnknownEffect(Plan)(bad)),
        );
        expect(error.reason).toContain("Read-only");
      }
      const badEntry = {
        ...raw,
        features: [
          ...raw.features,
          { name: "command", kind: "feature", permission: null, edges: ["query"] },
        ],
      };
      const error = yield* Effect.flip(
        validatePlan(yield* Schema.decodeUnknownEffect(Plan)(badEntry)),
      );
      expect(error.issues[0]).toMatchObject({
        path: "features[1].edges[0]",
        reason: "Edge must target an operation: command -> query",
      });
      expect(
        yield* Effect.flip(
          Schema.decodeUnknownEffect(Plan)({
            ...raw,
            features: [{ ...raw.features[0], kind: "guess" }],
          }),
        ),
      ).toBeDefined();
    }),
);

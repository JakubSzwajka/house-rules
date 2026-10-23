import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { appMap, diffMaps, renderMap, renderMapDiff, validatePlan } from "../../index.ts";
import { app, modules, plan } from "./plan-fixtures.ts";

it.effect("map operation flags come from the real mounted descriptors", () =>
  Effect.gen(function* () {
    const built = app();
    try {
      const snapshot = yield* appMap(built);
      for (const operation of modules.mounts.flatMap((mount) => [...mount.operations])) {
        const mapped = snapshot.modules
          .flatMap((module) => module.operations)
          .find((each) => each.name === operation.name);
        for (const flag of ["readOnly", "destructive", "transactional", "needsApproval"] as const)
          expect(mapped?.[flag]).toBe(operation[flag]);
      }
      const html = renderMap(snapshot, "html");
      const remove = html.match(
        /<li class="node node-operation"[^>]*data-name="Store.remove"[\s\S]*?<\/li>/,
      )?.[0];
      expect(remove).toContain('class="badge badge-unit">transactional</span>');
      expect(remove).toContain('class="badge badge-approval">needs approval</span>');
      expect(
        renderMap(snapshot, "text")
          .split("\n")
          .every((line) => line.length <= 100),
      ).toBe(true);
    } finally {
      yield* Effect.promise(built.dispose);
    }
  }),
);

it.effect("changing only an operation flag appears in the structured and rendered diff", () =>
  Effect.gen(function* () {
    const before = yield* validatePlan(plan);
    for (const flag of ["transactional", "needsApproval"] as const) {
      const after = yield* validatePlan({
        ...plan,
        modules: plan.modules.map((module) => ({
          ...module,
          operations: module.operations.map((op) =>
            op.name === "Views.list" ? { ...op, [flag]: true } : op,
          ),
        })),
      });
      const diff = diffMaps(before, after);
      expect(diff.empty).toBe(false);
      expect(diff.operations.changed).toEqual([
        { name: "Views.list", fields: [{ field: flag, before: "false", after: "true" }] },
      ]);
      expect(renderMapDiff(diff, "text")).toContain(`${flag}: false → true`);
      expect(renderMapDiff(diff, "html")).toContain(`${flag}`);
    }
  }),
);

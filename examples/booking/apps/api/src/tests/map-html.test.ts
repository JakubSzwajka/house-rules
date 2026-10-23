import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { diffMaps, Plan, renderMap, renderMapDiff, validatePlan } from "@house-rules/application";
import { mapSnapshot } from "../../scripts/map.ts";

const bookingPlan = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(new URL("../../plan.json", import.meta.url).pathname);
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Plan))(text);
});

it.effect("booking html map is deterministic and names every part of the app", () =>
  Effect.gen(function* () {
    const snapshot = yield* mapSnapshot;
    const html = renderMap(snapshot, "html");
    assert.strictEqual(renderMap(yield* mapSnapshot, "html"), html);
    const names = [
      ...snapshot.ways.map((way) => way.name),
      ...snapshot.features.map((feature) => feature.name),
      ...snapshot.modules.flatMap((module) => module.operations.map((op) => op.name)),
      ...(snapshot.plugs ?? []).map((plug) => plug.name),
    ];
    assert.isAbove(names.length, 70);
    for (const name of names) assert.include(html, `>${name}<`);
    assert.include(html, "as system: creator of organisation");
  }),
);

it.effect("booking plan.json diffs empty against the built app", () =>
  Effect.gen(function* () {
    const diff = diffMaps(yield* mapSnapshot, yield* validatePlan(yield* bookingPlan));
    assert.isTrue(diff.empty);
    assert.strictEqual(
      renderMapDiff(diff, "text"),
      "MAP DIFF\n No changes: both maps describe the same app.\n",
    );
    assert.notInclude(renderMapDiff(diff, "html"), 'class="mark');
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("a modified booking plan diffs to exactly its changes", () =>
  Effect.gen(function* () {
    const plan = yield* bookingPlan;
    const modified: Plan = {
      ...plan,
      features: [
        ...plan.features.filter((feature) => feature.name !== "list_roles"),
        {
          name: "rate_booking",
          permission: null,
          transactional: true,
          edges: ["Bookings.get"],
        },
      ],
      ways: plan.ways.map((way) =>
        way.name === "web"
          ? {
              ...way,
              features: [...way.features.filter((name) => name !== "list_roles"), "rate_booking"],
            }
          : way,
      ),
    };
    const diff = diffMaps(yield* mapSnapshot, yield* validatePlan(modified));
    assert.isFalse(diff.empty);
    assert.deepStrictEqual(diff.features.added, ["rate_booking"]);
    assert.deepStrictEqual(diff.features.removed, ["list_roles"]);
    assert.deepStrictEqual(diff.features.changed, []);
    assert.deepStrictEqual(diff.operations, { added: [], removed: [], changed: [] });
    assert.deepStrictEqual(diff.modules, { added: [], removed: [], changed: [] });
    assert.deepStrictEqual(diff.plugs, { added: [], removed: [], changed: [] });
    assert.deepStrictEqual(
      diff.ways.changed.map((way) => [way.name, way.fields.map((field) => field.field)]),
      [["web", ["features"]]],
    );
    assert.deepStrictEqual(diff.ways.changed[0]?.fields[0]?.added, ["rate_booking"]);
    assert.deepStrictEqual(diff.ways.changed[0]?.fields[0]?.removed, ["list_roles"]);
    const html = renderMapDiff(diff, "html");
    assert.include(html, "<li>new features: rate_booking</li>");
    assert.include(html, "<li>removed features: list_roles</li>");
    assert.notInclude(html, "module is-changed");
    assert.include(html, 'class="node node-feature is-removed"');
  }).pipe(Effect.provide(NodeServices.layer)),
);

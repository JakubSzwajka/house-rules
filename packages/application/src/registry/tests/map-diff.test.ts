import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  type AppMapSnapshot,
  diffMaps,
  type MapDiff,
  type Plan,
  renderMapDiff,
  validatePlan,
} from "../../index.ts";
import { plan } from "./plan-fixtures.ts";

const sections = ["modules", "operations", "features", "ways", "plugs", "permissions"] as const;

const changedPlan: Plan = {
  ...plan,
  modules: plan.modules.map((module) =>
    module.name === "store"
      ? {
          ...module,
          operations: [
            ...module.operations.map((op) =>
              op.name === "Store.remove" ? { ...op, permission: "items:purge" as const } : op,
            ),
            { name: "Store.archive", permission: "items:write", transactional: true },
          ],
        }
      : module,
  ),
  features: [
    ...plan.features.filter((feature) => feature.name !== "hidden_report"),
    { name: "archive_item", permission: null, edges: ["Store.archive"] },
  ],
  ways: plan.ways.map((way) =>
    way.name === "mcp" ? { ...way, features: [...way.features, "archive_item"] } : way,
  ),
};

it.effect("identical maps diff to nothing", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan(plan);
    const diff = diffMaps(snapshot, snapshot);
    expect(diff.empty).toBe(true);
    for (const kind of sections)
      expect(diff[kind]).toEqual({ added: [], removed: [], changed: [] });
    expect(renderMapDiff(diff, "text")).toBe(
      "MAP DIFF\n No changes: both maps describe the same app.\n",
    );
    expect(renderMapDiff(diff, "html")).toBe(renderMapDiff(diffMaps(snapshot, snapshot), "html"));
  }),
);

it.effect("a crafted change lists exactly the changed items", () =>
  Effect.gen(function* () {
    const before = yield* validatePlan(plan);
    const after = yield* validatePlan(changedPlan);
    const diff = diffMaps(before, after);
    expect(diff.empty).toBe(false);
    expect(diff.modules).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.plugs).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.operations).toEqual({
      added: ["Store.archive"],
      removed: [],
      changed: [
        {
          name: "Store.remove",
          fields: [{ field: "permission", before: "items:remove", after: "items:purge" }],
        },
      ],
    });
    expect(diff.features.added).toEqual(["archive_item"]);
    expect(diff.features.removed).toEqual(["hidden_report"]);
    expect(diff.features.changed.map((each) => each.name)).toEqual(["nightly_item", "remove_item"]);
    expect(diff.features.changed[1]?.fields).toEqual([
      {
        field: "person closure",
        before: "items:remove",
        after: "items:purge",
        added: ["items:purge"],
        removed: ["items:remove"],
      },
    ]);
    expect(diff.ways.changed).toEqual([
      {
        name: "mcp",
        fields: [
          {
            field: "features",
            before: "list_items",
            after: "archive_item, list_items",
            added: ["archive_item"],
            removed: [],
          },
        ],
      },
    ]);
    expect(diff.permissions).toEqual({
      added: ["items:purge"],
      removed: ["items:remove"],
      changed: [
        {
          name: "items:write",
          fields: [
            {
              field: "operations",
              before: "Store.save",
              after: "Store.archive, Store.save",
              added: ["Store.archive"],
              removed: [],
            },
          ],
        },
      ],
    });
    const text = renderMapDiff(diff, "text");
    expect(text).toContain(" new features: archive_item\n removed features: hidden_report\n");
    expect(text).toContain(" new operations: Store.archive\n");
    expect(text).toContain("     permission: items:remove → items:purge\n");
    expect(text).toContain(" ~ mcp\n     features: + archive_item\n");
    const html = renderMapDiff(diff, "html");
    expect(html).toContain("<li>new features: archive_item</li>");
    expect(html).toContain('class="node node-feature is-added"');
    expect(html).toContain('class="node node-feature is-removed"');
    expect(html).toContain('class="node node-operation is-changed"');
    expect(html).toContain(">hidden_report<");
    expect(renderMapDiff(diffMaps(before, after), "html")).toBe(html);
  }),
);

const field = (diff: MapDiff, kind: (typeof sections)[number], name: string, key: string) =>
  diff[kind].changed.find((each) => each.name === name)?.fields.find((each) => each.field === key);
const mutate = (snapshot: AppMapSnapshot, edit: (from: AppMapSnapshot) => AppMapSnapshot) =>
  diffMaps(snapshot, edit(snapshot));

it.effect("exposure, renames, plugs, catalogue and flags each show as a change", () =>
  Effect.gen(function* () {
    const base = yield* validatePlan(plan);
    const moved = mutate(base, (from) => ({
      ...from,
      features: from.features.map((each) =>
        each.name === "list_items" ? { ...each, ways: ["web"] } : each,
      ),
      ways: from.ways.map((way) =>
        way.name === "mcp"
          ? { ...way, features: way.features.filter((name) => name !== "list_items") }
          : way,
      ),
    }));
    expect(field(moved, "features", "list_items", "ways")?.removed).toEqual(["mcp"]);
    expect(moved.ways.changed.map((each) => each.name)).toEqual(["mcp"]);
    const renamed = mutate(base, (from) => ({
      ...from,
      modules: from.modules.map((module) => ({
        ...module,
        operations: module.operations.map((op) =>
          op.name === "Views.list" ? { ...op, name: "Views.all" } : op,
        ),
      })),
      features: from.features.map((each) => ({
        ...each,
        edges: each.edges.map((edge) =>
          edge.target === "Views.list" ? { ...edge, target: "Views.all" } : edge,
        ),
      })),
    }));
    expect(renamed.operations.added).toEqual(["Views.all"]);
    expect(renamed.operations.removed).toEqual(["Views.list"]);
    expect(field(renamed, "features", "list_items", "edges")).toMatchObject({
      added: ["Views.all"],
      removed: ["Views.list"],
    });
    const plugged = mutate(base, (from) => ({
      ...from,
      plugs: (from.plugs ?? []).map((plug) =>
        plug.name === "May.fixed" ? { ...plug, package: "@custom/may" } : plug,
      ),
    }));
    expect(field(plugged, "plugs", "May.fixed", "package")?.after).toBe("@custom/may");
    const catalogue = mutate(base, (from) => ({
      ...from,
      permissions: from.permissions.map((each) =>
        each.name === "items:write"
          ? { ...each, operations: [...each.operations, "Other.write"] }
          : each,
      ),
    }));
    expect(field(catalogue, "permissions", "items:write", "operations")?.added).toEqual([
      "Other.write",
    ]);
    const flagged = mutate(base, (from) => ({
      ...from,
      features: from.features.map((each) =>
        each.name === "save_item"
          ? { ...each, flags: { ...each.flags, needsApproval: true } }
          : each,
      ),
    }));
    expect(field(flagged, "features", "save_item", "needsApproval")?.after).toBe("true");
  }),
);

const read = { name: "Ops.read", permission: null, readOnly: true } as const;
const twoStores = (owner: "A" | "B"): Plan => ({
  modules: (["A", "B"] as const).map((service) => ({
    name: "store",
    service,
    kind: "package" as const,
    operations: service === owner ? [read] : [],
  })),
  features: [{ name: "read", permission: null, readOnly: true, edges: ["Ops.read"] }],
  ways: [],
});

it.effect("an operation moving between same-name modules is a change", () =>
  Effect.gen(function* () {
    const diff = diffMaps(yield* validatePlan(twoStores("A")), yield* validatePlan(twoStores("B")));
    expect(diff.empty).toBe(false);
    expect(diff.operations.changed).toEqual([
      {
        name: "Ops.read",
        fields: [{ field: "module", before: "store [service A]", after: "store [service B]" }],
      },
    ]);
    expect(renderMapDiff(diff, "text")).not.toContain("No changes");
  }),
);

it.effect("a module change marks only that module, even when another shares its name", () =>
  Effect.gen(function* () {
    const before = yield* validatePlan(twoStores("A"));
    const after = yield* validatePlan({
      ...twoStores("A"),
      modules: twoStores("A").modules.map((module) =>
        module.service === "B" ? { ...module, package: "@test/b" } : module,
      ),
    });
    const diff = diffMaps(before, after);
    const fields = [{ field: "package", before: "none", after: "@test/b" }];
    expect(diff.modules.changed).toEqual([{ name: "store (B)", fields }]);
    expect(renderMapDiff(diff, "html").match(/class="module is-changed"/g)).toHaveLength(1);
  }),
);

it.effect("a plain edge turning into a system edge with the same words is a change", () =>
  Effect.gen(function* () {
    const plain: Plan = {
      modules: [
        {
          name: "store",
          service: "A",
          kind: "package",
          operations: [read, { ...read, name: "Ops.read (as system: audit)" }],
        },
      ],
      features: [
        { name: "read", permission: null, readOnly: true, edges: ["Ops.read (as system: audit)"] },
      ],
      ways: [],
    };
    const system: Plan = {
      ...plain,
      features: [
        {
          name: "read",
          permission: null,
          readOnly: true,
          edges: [{ target: "Ops.read", reason: "audit" }],
        },
      ],
    };
    const diff = diffMaps(yield* validatePlan(plain), yield* validatePlan(system));
    expect(diff.empty).toBe(false);
    expect(field(diff, "features", "read", "edges")).toMatchObject({
      added: ['Ops.read (as system: audit) [system operation edge to "Ops.read" for "audit"]'],
      removed: [
        'Ops.read (as system: audit) [plain operation edge to "Ops.read (as system: audit)"]',
      ],
    });
    expect(renderMapDiff(diff, "text")).not.toContain("No changes");
  }),
);

it.effect("an unset value and the word none are different facts", () =>
  Effect.gen(function* () {
    const before = yield* validatePlan(plan);
    const after = yield* validatePlan({
      ...plan,
      plugs: (plan.plugs ?? []).map((plug) =>
        plug.name === "test.who" ? { ...plug, package: "none" } : plug,
      ),
    });
    expect(diffMaps(before, after).plugs.changed).toEqual([
      {
        name: "test.who",
        fields: [{ field: "package", before: "none [not set]", after: 'none ["none"]' }],
      },
    ]);
  }),
);

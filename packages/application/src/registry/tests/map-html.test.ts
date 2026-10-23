import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  type AppMapSnapshot,
  diffMaps,
  renderMap,
  renderMapDiff,
  validatePlan,
} from "../../index.ts";
import { plan } from "./plan-fixtures.ts";

const reversed = (snapshot: AppMapSnapshot): AppMapSnapshot => ({
  ...snapshot,
  modules: [...snapshot.modules].reverse().map((module) => ({
    ...module,
    operations: [...module.operations]
      .reverse()
      .map((op) => ({ ...op, edges: [...op.edges].reverse() })),
  })),
  features: [...snapshot.features].reverse().map((feature) => ({
    ...feature,
    edges: [...feature.edges].reverse(),
    ways: [...feature.ways].reverse(),
    closures: {
      person: [...feature.closures.person].reverse(),
      system: [...feature.closures.system].reverse(),
    },
  })),
  ways: [...snapshot.ways].reverse().map((way) => ({
    ...way,
    features: [...way.features].reverse(),
    public: [...way.public].reverse(),
  })),
  permissions: [...snapshot.permissions]
    .reverse()
    .map((permission) => ({ ...permission, operations: [...permission.operations].reverse() })),
  plugs: [...(snapshot.plugs ?? [])]
    .reverse()
    .map((plug) => (plug.ways === undefined ? plug : { ...plug, ways: [...plug.ways].reverse() })),
});

it.effect("html map is deterministic and ignores input order", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan(plan);
    const html = renderMap(snapshot, "html");
    expect(renderMap(snapshot, "html")).toBe(html);
    expect(renderMap(reversed(snapshot), "html")).toBe(html);
    expect(renderMapDiff(diffMaps(reversed(snapshot), reversed(snapshot)), "html")).toBe(
      renderMapDiff(diffMaps(snapshot, snapshot), "html"),
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
  }),
);

it.effect("html map names every way, feature, operation, plug and permission", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan(plan);
    const html = renderMap(snapshot, "html");
    const names = [
      ...snapshot.ways.map((way) => way.name),
      ...snapshot.features.map((feature) => feature.name),
      ...snapshot.modules.flatMap((module) => [
        module.name,
        ...module.operations.map((op) => op.name),
      ]),
      ...(snapshot.plugs ?? []).map((plug) => plug.name),
      ...snapshot.permissions.map((permission) => permission.name),
    ];
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(html).toContain(`>${name}<`);
    expect(html).toContain("as system: audit trail");
    expect(html).toContain("needs approval");
    expect(html).toContain("<code>0 3 * * *</code> UTC");
    expect(html).toContain('<button type="button" class="pick" aria-pressed="false">save_item');
  }),
);

it.effect("html map is self-contained and escapes names", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan(plan);
    const html = renderMap(snapshot, "html");
    for (const remote of ["<link", "<script src", "@import", "url(", "<img"])
      expect(html).not.toContain(remote);
    const hostile = renderMap(
      {
        ...snapshot,
        features: snapshot.features.map((feature) =>
          feature.name === "save_item"
            ? { ...feature, path: "</script><script>alert(1)</script>" }
            : feature,
        ),
      },
      "html",
    );
    expect(hostile).not.toContain("<script>alert(1)");
    expect(hostile).toContain("&lt;/script&gt;");
  }),
);

it.effect("feature relations include its ways, reached operations and their modules", () =>
  Effect.gen(function* () {
    const html = renderMap(yield* validatePlan(plan), "html");
    const rel = (name: string) =>
      new RegExp(`data-name="${name}" data-rel="([^"]*)"`).exec(html)?.[1]?.split(" ") ?? [];
    const ids = (name: string) =>
      new RegExp(`id="(\\w+)" data-node data-name="${name}"`).exec(html)?.[1];
    const related = rel("save_item");
    for (const name of ["web", "Store.save", "Store.audit", "list_items", "Views.list"])
      expect(related).toContain(ids(name));
    expect(related).not.toContain(ids("Store.remove"));
    expect(related).not.toContain(ids("mcp"));
    expect(related.filter((id) => id.startsWith("m"))).toHaveLength(2);
  }),
);

it.effect("same-name modules render the same whatever their input order", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan({
      modules: ["A", "B"].map((service) => ({
        name: "store",
        service,
        kind: "package" as const,
        operations: service === "A" ? [{ name: "Ops.read", permission: null, readOnly: true }] : [],
      })),
      features: [],
      ways: [],
    });
    const flipped = { ...snapshot, modules: [...snapshot.modules].reverse() };
    expect(renderMap(flipped, "html")).toBe(renderMap(snapshot, "html"));
    expect(renderMapDiff(diffMaps(flipped, flipped), "html")).toBe(
      renderMapDiff(diffMaps(snapshot, snapshot), "html"),
    );
  }),
);

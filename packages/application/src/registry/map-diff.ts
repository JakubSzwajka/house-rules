import type { AppMapSnapshot, MapEdge } from "./app-map-snapshot.ts";
import { canonical, compare } from "./app-map-order.ts";

export interface MapFieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
  readonly added?: readonly string[];
  readonly removed?: readonly string[];
}
export interface MapChanged {
  readonly name: string;
  readonly fields: readonly MapFieldChange[];
}
export interface MapDiffSection {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly MapChanged[];
}
export const mapDiffKinds = [
  "modules",
  "operations",
  "features",
  "ways",
  "plugs",
  "permissions",
] as const;
export type MapDiffKind = (typeof mapDiffKinds)[number];
export type MapDiff = Readonly<Record<MapDiffKind, MapDiffSection>> & {
  readonly empty: boolean;
  readonly before: AppMapSnapshot;
  readonly after: AppMapSnapshot;
};

type Item = Readonly<{ key: string; show: string; detail: string }>;
type Fact = Item | readonly Item[];
type Facts = Readonly<{ name: string; fields: Readonly<Record<string, Fact>> }>;

const item = (show: string, key: unknown = show, detail = JSON.stringify(show)): Item => ({
  key: JSON.stringify(key),
  show,
  detail,
});
const optional = (value: string | null | undefined): Item =>
  value == null ? item("none", null, "not set") : item(value);
const flag = (value: boolean): Item => item(String(value));
const list = (values: readonly string[]): Item[] => values.map((value) => item(value));
const edgeItems = (edges: readonly MapEdge[]): Item[] =>
  edges.map((edge) =>
    edge.reason === undefined
      ? item(
          edge.target,
          [edge.kind, edge.target, null],
          `plain ${edge.kind} edge to ${JSON.stringify(edge.target)}`,
        )
      : item(
          `${edge.target} (as system: ${edge.reason})`,
          [edge.kind, edge.target, edge.reason],
          `system ${edge.kind} edge to ${JSON.stringify(edge.target)} for ${JSON.stringify(edge.reason)}`,
        ),
  );

const keys = (items: readonly Item[]): string =>
  JSON.stringify(items.map((each) => each.key).sort(compare));
const labeller = (items: readonly Item[]) => {
  const owners = new Map<string, Set<string>>();
  for (const each of items)
    owners.set(each.show, (owners.get(each.show) ?? new Set()).add(each.key));
  return (each: Item): string =>
    (owners.get(each.show)?.size ?? 0) > 1 ? `${each.show} [${each.detail}]` : each.show;
};
const joined = (items: readonly Item[], label: (each: Item) => string): string =>
  items.length === 0 ? "none" : items.map(label).join(", ");
const isList = (fact: Fact): fact is readonly Item[] => Array.isArray(fact);
const change = (field: string, prior: Fact, next: Fact): MapFieldChange[] => {
  // Both sides come from the same facts() field, so they are both lists or both items.
  const [before, after] = [isList(prior) ? prior : [prior], isList(next) ? next : [next]];
  // Keys, not words: a plain edge to "X (as system: r)" reads like a system edge to X.
  if (keys(before) === keys(after)) return [];
  if (!isList(prior) && !isList(next)) {
    const label = labeller([prior, next]);
    return [{ field, before: label(prior), after: label(next) }];
  }
  const label = labeller([...before, ...after]);
  const has = (items: readonly Item[], each: Item) => items.some((other) => other.key === each.key);
  return [
    {
      field,
      before: joined(before, label),
      after: joined(after, label),
      added: after.filter((each) => !has(before, each)).map(label),
      removed: before.filter((each) => !has(after, each)).map(label),
    },
  ];
};

const facts = (
  data: AppMapSnapshot,
  shared: ReadonlySet<string>,
): Readonly<Record<MapDiffKind, Map<string, Facts>>> => ({
  // Modules key by service because two mounts may share a display name.
  modules: new Map(
    data.modules.map((module) => [
      module.service,
      {
        name: shared.has(module.name) ? `${module.name} (${module.service})` : module.name,
        fields: {
          name: item(module.name),
          kind: item(module.kind),
          role: item(module.role ?? "capability"),
          package: optional(module.package),
          path: optional(module.path),
        },
      },
    ]),
  ),
  operations: new Map(
    data.modules.flatMap((module) =>
      module.operations.map((op) => [
        op.name,
        {
          name: op.name,
          fields: {
            // Ownership is the mount service; the name is only how it reads.
            module: item(module.name, module.service, `service ${module.service}`),
            permission: optional(op.permission),
            readOnly: flag(op.readOnly),
            destructive: flag(op.destructive),
            transactional: flag(op.transactional),
            needsApproval: flag(op.needsApproval),
            edges: edgeItems(op.edges),
          },
        },
      ]),
    ),
  ),
  features: new Map(
    data.features.map((feature) => [
      feature.name,
      {
        name: feature.name,
        fields: {
          path: optional(feature.path),
          start:
            feature.start === "person"
              ? item("person", ["person"])
              : item(
                  `system (${feature.start.reason}) started by ${feature.start.startedBy}`,
                  ["system", feature.start.reason, feature.start.startedBy],
                  `system start for ${JSON.stringify(feature.start.reason)} by ${JSON.stringify(feature.start.startedBy)}`,
                ),
          permission: optional(feature.permission),
          readOnly: flag(feature.flags.readOnly),
          transactional: flag(feature.flags.transactional),
          destructive: flag(feature.flags.destructive),
          needsApproval: flag(feature.flags.needsApproval),
          "person closure": list(feature.closures.person),
          "system closure": list(feature.closures.system),
          edges: edgeItems(feature.edges),
          ways: list(feature.ways),
        },
      },
    ]),
  ),
  ways: new Map(
    data.ways.map((way) => [
      way.name,
      {
        name: way.name,
        fields: {
          protocol: item(way.protocol),
          address: (() => {
            const key = [
              way.slot ?? null,
              way.clock === undefined ? null : [way.clock.cron, way.clock.timeZone],
              way.path ?? null,
            ];
            const show =
              way.slot ??
              (way.clock === undefined
                ? (way.path ?? "none")
                : `${way.clock.cron} ${way.clock.timeZone}`);
            return item(show, key, JSON.stringify({ slot: key[0], clock: key[1], path: key[2] }));
          })(),
          source: optional(way.source),
          mean: optional(way.mean),
          features: list(way.features),
          public: list(way.public),
        },
      },
    ]),
  ),
  plugs: new Map(
    (data.plugs ?? []).map((plug) => [
      plug.name,
      {
        name: plug.name,
        fields: {
          fills: item(plug.fills),
          package: optional(plug.package),
          ways: list(plug.ways ?? []),
        },
      },
    ]),
  ),
  permissions: new Map(
    data.permissions.map((permission) => [
      permission.name,
      { name: permission.name, fields: { operations: list(permission.operations) } },
    ]),
  ),
});

const section = (
  before: ReadonlyMap<string, Facts>,
  after: ReadonlyMap<string, Facts>,
): MapDiffSection => {
  const names = (from: ReadonlyMap<string, Facts>, other: ReadonlyMap<string, Facts>) =>
    [...from]
      .filter(([key]) => !other.has(key))
      .map(([, value]) => value.name)
      .sort(compare);
  const changed: MapChanged[] = [];
  for (const [key, next] of after) {
    const prior = before.get(key);
    if (prior === undefined) continue;
    const fields = Object.entries(next.fields).flatMap(([field, fact]) => {
      const old = prior.fields[field];
      return old === undefined ? [] : change(field, old, fact);
    });
    if (fields.length > 0) changed.push({ name: next.name, fields });
  }
  return {
    added: names(after, before),
    removed: names(before, after),
    changed: changed.sort((a, b) => compare(a.name, b.name)),
  };
};

export const diffMaps = (before: AppMapSnapshot, after: AppMapSnapshot): MapDiff => {
  const [left, right] = [canonical(before), canonical(after)];
  // A module name shared by two services on either side reads with its service.
  const seen = new Map<string, Set<string>>();
  for (const module of [...left.modules, ...right.modules])
    seen.set(module.name, (seen.get(module.name) ?? new Set()).add(module.service));
  const shared = new Set(
    [...seen].filter(([, services]) => services.size > 1).map(([name]) => name),
  );
  const [old, next] = [facts(left, shared), facts(right, shared)];
  const sections = Object.fromEntries(
    mapDiffKinds.map((kind) => [kind, section(old[kind], next[kind])]),
  ) as Record<MapDiffKind, MapDiffSection>;
  return {
    ...sections,
    empty: mapDiffKinds.every(
      (kind) =>
        sections[kind].added.length === 0 &&
        sections[kind].removed.length === 0 &&
        sections[kind].changed.length === 0,
    ),
    before: left,
    after: right,
  };
};

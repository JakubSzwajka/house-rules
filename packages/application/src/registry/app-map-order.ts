import type { AppMapSnapshot, MapEdge } from "./app-map-snapshot.ts";

export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const named = <A extends { readonly name: string }>(values: readonly A[]): A[] =>
  [...values].sort((a, b) => compare(a.name, b.name));
export const strings = (values: readonly string[]): string[] => [...values].sort(compare);
export const sortEdges = (values: readonly MapEdge[]): MapEdge[] =>
  [...values].sort(
    (a, b) =>
      compare(a.target, b.target) ||
      compare(a.kind, b.kind) ||
      compare(a.reason ?? "", b.reason ?? "") ||
      Number(a.reason !== undefined) - Number(b.reason !== undefined),
  );

export const canonical = (data: AppMapSnapshot): AppMapSnapshot => ({
  layers: data.layers,
  // Same-name modules fall back to their service, so input order never changes the output.
  modules: [...data.modules]
    .sort((a, b) => compare(a.name, b.name) || compare(a.service, b.service))
    .map((module) => ({
      ...module,
      role: module.role ?? "capability",
      operations: named(module.operations).map((operation) => ({
        ...operation,
        edges: sortEdges(operation.edges),
      })),
    })),
  features: named(data.features).map((feature) => ({
    ...feature,
    closures: {
      person: strings(feature.closures.person),
      system: strings(feature.closures.system),
    },
    edges: sortEdges(feature.edges),
    ways: strings(feature.ways),
  })),
  ways: named(data.ways).map((way) => ({
    ...way,
    features: strings(way.features),
    public: strings(way.public),
  })),
  permissions: named(data.permissions).map((permission) => ({
    ...permission,
    operations: strings(permission.operations),
  })),
  ...(data.plugs === undefined
    ? {}
    : {
        plugs: named(data.plugs).map((plug) =>
          plug.ways === undefined ? plug : { ...plug, ways: strings(plug.ways) },
        ),
      }),
});

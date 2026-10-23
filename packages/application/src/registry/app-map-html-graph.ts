import type { AppMapSnapshot, MapEdge } from "./app-map-snapshot.ts";
import { compare } from "./app-map-order.ts";

export interface MapGraph {
  readonly way: ReadonlyMap<string, string>;
  readonly feature: ReadonlyMap<string, string>;
  readonly operation: ReadonlyMap<string, string>;
  readonly module: ReadonlyMap<string, string>;
  readonly related: ReadonlyMap<string, readonly string[]>;
  readonly wires: readonly (readonly [string, string, 0 | 1])[];
}

export const mapGraph = (data: AppMapSnapshot): MapGraph => {
  const way = new Map(data.ways.map((each, index) => [each.name, `w${index}`]));
  const feature = new Map(data.features.map((each, index) => [each.name, `f${index}`]));
  const module = new Map(data.modules.map((each, index) => [each.service, `m${index}`]));
  const operation = new Map<string, string>();
  const home = new Map<string, string>();
  for (const [index, each] of data.modules.entries())
    for (const op of each.operations) {
      operation.set(op.name, `o${operation.size}`);
      home.set(op.name, `m${index}`);
    }
  const callable = (name: string): string | undefined => feature.get(name) ?? operation.get(name);
  const calls = new Map<string, readonly MapEdge[]>([
    ...data.features.map((each) => [each.name, each.edges] as const),
    ...data.modules.flatMap((each) => each.operations.map((op) => [op.name, op.edges] as const)),
  ]);
  const callers = new Map<string, string[]>();
  for (const [name, edges] of calls)
    for (const edge of edges) callers.set(edge.target, [...(callers.get(edge.target) ?? []), name]);
  const walk = (start: readonly string[], next: (name: string) => readonly string[]): string[] => {
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length > 0) {
      const name = stack.pop() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      stack.push(...next(name));
    }
    return [...seen];
  };
  const down = (name: string) => (calls.get(name) ?? []).map((edge) => edge.target);
  const up = (name: string) => callers.get(name) ?? [];
  const exposure = (names: readonly string[]) =>
    data.ways.filter((each) => each.features.some((name) => names.includes(name)));
  const ids = (names: readonly string[]): string[] =>
    names.flatMap((name) => {
      const id = callable(name);
      const owner = home.get(name);
      return [...(id === undefined ? [] : [id]), ...(owner === undefined ? [] : [owner])];
    });
  const related = new Map<string, readonly string[]>();
  const keep = (id: string | undefined, values: readonly string[]): void => {
    if (id !== undefined)
      related.set(id, [...new Set(values)].filter((each) => each !== id).sort(compare));
  };
  for (const each of data.features) {
    const reach = walk([each.name], down);
    const wayIds = each.ways.flatMap((name) => way.get(name) ?? []);
    keep(feature.get(each.name), [...ids(reach), ...wayIds]);
  }
  for (const each of data.ways) {
    const reach = walk(each.features, down);
    keep(way.get(each.name), ids(reach));
  }
  for (const name of operation.keys()) {
    const reach = walk([name], down);
    const above = walk([name], up);
    const wayIds = exposure(above).flatMap((each) => way.get(each.name) ?? []);
    keep(operation.get(name), [...ids(reach), ...ids(above), ...wayIds]);
  }
  const wires: (readonly [string, string, 0 | 1])[] = [];
  for (const each of data.ways)
    for (const name of each.features) {
      const [from, to] = [way.get(each.name), feature.get(name)];
      if (from !== undefined && to !== undefined) wires.push([from, to, 0]);
    }
  for (const [name, edges] of calls)
    for (const edge of edges) {
      const [from, to] = [callable(name), callable(edge.target)];
      if (from !== undefined && to !== undefined)
        wires.push([from, to, edge.reason === undefined ? 0 : 1]);
    }
  return { way, feature, operation, module, related, wires };
};

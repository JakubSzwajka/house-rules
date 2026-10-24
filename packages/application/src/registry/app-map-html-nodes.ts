import type { AppMapSnapshot, MapEdge, MapModule } from "./app-map-snapshot.ts";
import type { MapGraph } from "./app-map-html-graph.ts";
import { moduleGroups, moduleOwner } from "./app-map-modules.ts";
import { badge, code, esc, list, type Mark, markClass, markLabel } from "./html-text.ts";

export type Marks = ReadonlyMap<string, Mark>;
type Feature = AppMapSnapshot["features"][number];
type Way = AppMapSnapshot["ways"][number];

const protocols = { http: "HTTP", mcp: "MCP", hook: "hook", schedule: "schedule" } as const;

const node = (
  graph: MapGraph,
  id: string,
  kind: string,
  mark: Mark | undefined,
  name: string,
  head: string,
  body: string,
): string =>
  `<li class="node node-${kind}${markClass(mark)}" id="${id}" data-node data-name="${esc(name)}" data-rel="${(graph.related.get(id) ?? []).join(" ")}">` +
  `<h4 class="node-head"><button type="button" class="pick" aria-pressed="false">${esc(name)}</button>${markLabel(mark)}${head}</h4>${body}</li>`;

const ref = (graph: MapGraph, name: string): string => {
  const id = graph.feature.get(name) ?? graph.operation.get(name) ?? graph.way.get(name);
  return id === undefined ? code(name) : `<a class="ref" href="#${id}">${esc(name)}</a>`;
};

const edgeList = (graph: MapGraph, edges: readonly MapEdge[]): string =>
  edges.length === 0
    ? `<span class="muted">nothing</span>`
    : `<ul class="edges">${edges
        .map((edge) =>
          edge.reason === undefined
            ? `<li>${ref(graph, edge.target)}</li>`
            : `<li class="edge-system">${ref(graph, edge.target)} <span class="as-system">as system: ${esc(edge.reason)}</span></li>`,
        )
        .join("")}</ul>`;

const facts = (rows: readonly (readonly [string, string] | undefined)[]): string =>
  `<dl class="facts">${rows
    .flatMap((row) => (row === undefined ? [] : [`<dt>${esc(row[0])}</dt><dd>${row[1]}</dd>`]))
    .join("")}</dl>`;

type Flags = Readonly<{
  readOnly: boolean;
  destructive: boolean;
  transactional: boolean;
  needsApproval: boolean;
}>;

const flagBadges = (flags: Flags): string => {
  const shown = [
    flags.readOnly ? badge("read", "read-only") : "",
    flags.transactional === true ? badge("unit", "transactional") : "",
    flags.destructive ? badge("destructive", "destructive") : "",
    flags.needsApproval === true ? badge("approval", "needs approval") : "",
  ].join("");
  return shown === "" ? "" : `<span class="badges">${shown}</span>`;
};

const source = (path: string | undefined): string =>
  path === undefined ? "" : `<p class="source">${code(path)}</p>`;

const address = (way: Way): string =>
  way.slot !== undefined
    ? `slot ${code(way.slot)}`
    : way.clock !== undefined
      ? `${code(way.clock.cron)} ${esc(way.clock.timeZone)}`
      : code(way.path ?? "");

const wayNode = (graph: MapGraph, marks: Marks, way: Way): string =>
  node(
    graph,
    graph.way.get(way.name) ?? "",
    "way",
    marks.get(`way:${way.name}`),
    way.name,
    `<span class="badges">${badge("protocol", protocols[way.protocol])}</span>`,
    `<p class="address">${address(way)}</p>` +
      facts([
        way.mean === undefined ? undefined : ["Mean", esc(way.mean)],
        [
          "Exposes",
          `${way.features.length} feature${way.features.length === 1 ? "" : "s"}${way.public.length === 0 ? "" : `, ${way.public.length} public`}`,
        ],
        way.public.length === 0
          ? undefined
          : ["Public", way.public.map((name) => ref(graph, name)).join(" ")],
      ]) +
      source(way.source),
  );

export const waysColumn = (data: AppMapSnapshot, graph: MapGraph, marks: Marks): string => {
  const group = (title: string, ways: readonly Way[], note: string): string =>
    ways.length === 0
      ? ""
      : `<h3 class="group">${esc(title)}</h3><p class="note">${esc(note)}</p><ul class="nodes">${ways.map((way) => wayNode(graph, marks, way)).join("")}</ul>`;
  const network = data.ways.filter((way) => way.protocol === "http" || way.protocol === "mcp");
  const system = data.ways.filter((way) => way.protocol === "hook" || way.protocol === "schedule");
  return (
    group("Network", network, "People and agents call in here.") +
    group("System", system, "Hooks and schedules start features as the system.")
  );
};

const start = (feature: Feature): string =>
  feature.start === "person"
    ? "person"
    : `system: ${esc(feature.start.reason)}, started by ${esc(feature.start.startedBy)}`;

export const featureNode = (graph: MapGraph, marks: Marks, feature: Feature): string =>
  node(
    graph,
    graph.feature.get(feature.name) ?? "",
    "feature",
    marks.get(`feature:${feature.name}`),
    feature.name,
    flagBadges(feature.flags),
    facts([
      feature.start === "person" ? undefined : ["Start", start(feature)],
      [
        "On",
        feature.ways.length === 0
          ? `<span class="muted">no way; in-process only</span>`
          : feature.ways.map((name) => ref(graph, name)).join(" "),
      ],
      ["Calls", edgeList(graph, feature.edges)],
      ["Needs", list(feature.closures.person)],
      feature.closures.system.length === 0
        ? undefined
        : ["System needs", list(feature.closures.system)],
      feature.permission === null ? undefined : ["Permission", code(feature.permission)],
    ]) + source(feature.path),
  );

const moduleGroup = (graph: MapGraph, marks: Marks, module: MapModule): string => {
  const id = graph.module.get(module.service) ?? "";
  const mark = marks.get(`module:${module.service}`);
  const where = [module.package, module.path].flatMap((each) =>
    each === undefined ? [] : [code(each)],
  );
  return (
    `<section class="module${markClass(mark)}" id="${id}" data-module aria-labelledby="${id}-name">` +
    `<h3 class="module-head" id="${id}-name">${esc(module.name)}${markLabel(mark)}${badge("owner", moduleOwner(module))}</h3>` +
    (where.length === 0 ? "" : `<p class="note">${where.join(" · ")}</p>`) +
    `<ul class="nodes">${module.operations
      .map((op) =>
        node(
          graph,
          graph.operation.get(op.name) ?? "",
          "operation",
          marks.get(`operation:${op.name}`),
          op.name,
          flagBadges(op),
          facts([
            ["Permission", op.permission === null ? "none" : code(op.permission)],
            op.edges.length === 0 ? undefined : ["Calls", edgeList(graph, op.edges)],
          ]),
        ),
      )
      .join("")}</ul></section>`
  );
};

export const operationsColumn = (data: AppMapSnapshot, graph: MapGraph, marks: Marks): string =>
  moduleGroups(data)
    .map(({ title, modules }) => {
      return modules.length === 0
        ? ""
        : `<h3 class="group">${title}</h3>${modules
            .map((module) => moduleGroup(graph, marks, module))
            .join("")}`;
    })
    .join("");

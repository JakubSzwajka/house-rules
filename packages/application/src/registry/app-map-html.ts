import type { AppMapSnapshot } from "./app-map-snapshot.ts";
import { mapGraph, type MapGraph } from "./app-map-html-graph.ts";
import { featureNode, type Marks, operationsColumn, waysColumn } from "./app-map-html-nodes.ts";
import { mapScript, mapStyle } from "./app-map-html-style.ts";
import { code, esc, type Mark, markLabel, scriptJson } from "./html-text.ts";

const row = (mark: Mark | undefined): string =>
  mark === undefined ? "<tr>" : `<tr class="is-${mark}">`;

export interface MapHtmlOptions {
  readonly title?: string;
  readonly lead?: string;
  readonly marks?: Marks;
  readonly before?: string;
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `<li><strong>${count}</strong> ${count === 1 ? one : many}</li>`;

const featuresColumn = (data: AppMapSnapshot, graph: MapGraph, marks: Marks): string => {
  const group = (title: string, person: boolean): string => {
    const features = data.features.filter((feature) => (feature.start === "person") === person);
    return features.length === 0
      ? ""
      : `<h3 class="group">${esc(title)}</h3><ul class="nodes">${features
          .map((feature) => featureNode(graph, marks, feature))
          .join("")}</ul>`;
  };
  return group("Started by a person", true) + group("Started by the system", false);
};

const permissionsTable = (data: AppMapSnapshot, graph: MapGraph, marks: Marks): string => {
  const needed = (name: string, side: "person" | "system"): string[] =>
    data.features
      .filter((feature) => feature.closures[side].includes(name))
      .map((feature) => feature.name);
  const link = (name: string): string => {
    const id = graph.feature.get(name) ?? graph.operation.get(name);
    return id === undefined ? code(name) : `<a class="ref" href="#${id}">${esc(name)}</a>`;
  };
  const links = (names: readonly string[]): string =>
    names.length === 0 ? `<span class="muted">none</span>` : names.map(link).join(" ");
  const rows = data.permissions.map((permission) => {
    const mark = marks.get(`permission:${permission.name}`);
    return `${row(mark)}<th scope="row">${code(permission.name)}${markLabel(mark)}</th><td>${links(permission.operations)}</td><td>${links(needed(permission.name, "person"))}</td><td>${links(needed(permission.name, "system"))}</td></tr>`;
  });
  return (
    `<section class="below" aria-labelledby="permissions"><h2 id="permissions">Permission catalogue</h2>` +
    `<p class="note">Each permission, the operations that declare it, and the features whose person or system closure needs it.</p>` +
    `<div class="table-wrap"><table><thead><tr><th scope="col">Permission</th><th scope="col">Declared by operations</th><th scope="col">Person closure of</th><th scope="col">System closure of</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div></section>`
  );
};

const plugsTable = (data: AppMapSnapshot, graph: MapGraph, marks: Marks): string => {
  const plugs = data.plugs ?? [];
  const rows = plugs.map((plug) => {
    const mark = marks.get(`plug:${plug.name}`);
    const ways = (plug.ways ?? []).map((name) => {
      const id = graph.way.get(name);
      return id === undefined ? code(name) : `<a class="ref" href="#${id}">${esc(name)}</a>`;
    });
    return `${row(mark)}<th scope="row">${code(plug.name)}${markLabel(mark)}</th><td>${code(plug.fills)}</td><td>${ways.length === 0 ? `<span class="muted">whole app</span>` : ways.join(" ")}</td><td>${plug.package === undefined ? `<span class="muted">app</span>` : code(plug.package)}</td></tr>`;
  });
  return (
    `<section class="below" aria-labelledby="plugs"><h2 id="plugs">Plugs</h2>` +
    `<p class="note">What fills each socket, port or hook slot, and where.</p>` +
    (plugs.length === 0
      ? `<p class="muted">No plugs recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Plug</th><th scope="col">Fills</th><th scope="col">On ways</th><th scope="col">Package</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`) +
    `</section>`
  );
};

const legend =
  `<p class="legend" aria-label="Legend">` +
  `<span><svg width="34" height="8" aria-hidden="true"><path d="M1 4H33" stroke="currentColor" stroke-width="1.4"/></svg> call keeps the caller</span>` +
  `<span><svg width="34" height="8" aria-hidden="true"><path d="M1 4H33" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/></svg> system edge, with its reason</span>` +
  `<span class="badge badge-read">read-only</span><span class="badge badge-unit">transactional</span><span class="badge badge-destructive">destructive</span><span class="badge badge-approval">needs approval</span></p>`;

export const appMapHtml = (data: AppMapSnapshot, options: MapHtmlOptions = {}): string => {
  const graph = mapGraph(data);
  const marks = options.marks ?? new Map();
  const title = options.title ?? "App map";
  const operations = data.modules.reduce((sum, module) => sum + module.operations.length, 0);
  const hint =
    "Point at or select a way, feature or operation to trace what it reaches. Press Esc to clear.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${mapStyle}</style>
</head>
<body>
<div class="page">
<header class="top">
<h1>${esc(title)}</h1>
<p class="lead">${esc(options.lead ?? data.layers)}</p>
<ul class="counts">${plural(data.ways.length, "way")}${plural(data.features.length, "feature")}${plural(operations, "operation")}${plural(data.modules.length, "module or read model", "modules and read models")}${plural(data.permissions.length, "permission")}${plural((data.plugs ?? []).length, "plug")}</ul>
${legend}
</header>
${options.before ?? ""}
<main>
<p class="status" id="map-status" role="status" aria-live="polite">${esc(hint)}</p>
<div class="map" data-map>
<svg class="wires" aria-hidden="true" focusable="false"></svg>
<section class="col" aria-labelledby="col-ways"><h2 id="col-ways">Ways in</h2><p class="note">Where calls enter the app.</p>${waysColumn(data, graph, marks)}</section>
<section class="col" aria-labelledby="col-features"><h2 id="col-features">Features</h2><p class="note">What a person or the system can do, with its flags and permission closures.</p>${featuresColumn(data, graph, marks)}</section>
<section class="col" aria-labelledby="col-operations"><h2 id="col-operations">Operations</h2><p class="note">What each module or read model can do.</p>${operationsColumn(data, graph, marks)}</section>
</div>
${permissionsTable(data, graph, marks)}
${plugsTable(data, graph, marks)}
</main>
</div>
<script type="application/json" id="map-wires">${scriptJson(graph.wires)}</script>
<script>${mapScript}</script>
</body>
</html>
`;
};

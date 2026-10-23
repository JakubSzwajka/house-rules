import type { AppMapSnapshot, MapModule } from "./app-map-snapshot.ts";
import { appMapHtml } from "./app-map-html.ts";
import { canonical } from "./app-map-order.ts";
import { esc, type Mark } from "./html-text.ts";
import { type MapDiff, type MapDiffKind, type MapFieldChange, mapDiffKinds } from "./map-diff.ts";

const order: readonly MapDiffKind[] = [
  "features",
  "modules",
  "operations",
  "ways",
  "plugs",
  "permissions",
];

export const mapDiffSummary = (diff: MapDiff): string[] => {
  if (diff.empty) return ["No changes: both maps describe the same app."];
  const lines: string[] = [];
  for (const kind of order) {
    const { added, removed } = diff[kind];
    if (added.length > 0) lines.push(`new ${kind}: ${added.join(", ")}`);
    if (removed.length > 0) lines.push(`removed ${kind}: ${removed.join(", ")}`);
  }
  // Exposure gets its own line, so a feature whose only change is its ways is not repeated.
  const exposure = diff.features.changed.flatMap((each) =>
    each.fields
      .filter((field) => field.field === "ways")
      .map(
        (field) =>
          `${each.name} (${[
            ...(field.added ?? []).map((way) => `now on ${way}`),
            ...(field.removed ?? []).map((way) => `no longer on ${way}`),
          ].join(", ")})`,
      ),
  );
  if (exposure.length > 0) lines.push(`changed exposure: ${exposure.join("; ")}`);
  for (const kind of order) {
    const changed = diff[kind].changed.flatMap((each) => {
      const fields = each.fields
        .map((field) => field.field)
        .filter((field) => kind !== "features" || field !== "ways");
      return fields.length === 0 ? [] : [`${each.name} (${fields.join(", ")})`];
    });
    if (changed.length > 0) lines.push(`changed ${kind}: ${changed.join("; ")}`);
  }
  return lines;
};

export const mapDiffText = (diff: MapDiff): string => {
  const lines = ["MAP DIFF", ...mapDiffSummary(diff).map((line) => ` ${line}`)];
  for (const kind of mapDiffKinds) {
    const { added, removed, changed } = diff[kind];
    if (added.length + removed.length + changed.length === 0) continue;
    lines.push("", kind.toUpperCase());
    for (const name of added) lines.push(` + ${name}`);
    for (const name of removed) lines.push(` - ${name}`);
    for (const each of changed) {
      lines.push(` ~ ${each.name}`);
      for (const field of each.fields)
        lines.push(
          field.added === undefined || field.removed === undefined
            ? `     ${field.field}: ${field.before} → ${field.after}`
            : `     ${field.field}: ${[
                ...field.added.map((item) => `+ ${item}`),
                ...field.removed.map((item) => `- ${item}`),
              ].join(", ")}`,
        );
    }
  }
  return `${lines.join("\n")}\n`;
};

const missing = <A extends { readonly name: string }>(
  values: readonly A[],
  others: readonly A[],
): A[] => values.filter((value) => !others.some((other) => other.name === value.name));

const merged = (before: AppMapSnapshot, after: AppMapSnapshot): AppMapSnapshot => {
  const ops = new Set(after.modules.flatMap((module) => module.operations.map((op) => op.name)));
  return canonical({
    ...after,
    modules: [
      ...after.modules.map((module) => {
        const prior = before.modules.find((each) => each.service === module.service);
        const gone = (prior?.operations ?? []).filter((op) => !ops.has(op.name));
        return { ...module, operations: [...module.operations, ...gone] };
      }),
      ...before.modules
        .filter((module) => !after.modules.some((each) => each.service === module.service))
        .map((module) => ({
          ...module,
          operations: module.operations.filter((op) => !ops.has(op.name)),
        })),
    ],
    features: [...after.features, ...missing(before.features, after.features)],
    ways: [...after.ways, ...missing(before.ways, after.ways)],
    permissions: [...after.permissions, ...missing(before.permissions, after.permissions)],
    plugs: [...(after.plugs ?? []), ...missing(before.plugs ?? [], after.plugs ?? [])],
  });
};

const marks = (diff: MapDiff): Map<string, Mark> => {
  const result = new Map<string, Mark>();
  const keys = {
    operations: "operation",
    features: "feature",
    ways: "way",
    plugs: "plug",
    permissions: "permission",
  } as const;
  for (const kind of Object.keys(keys) as (keyof typeof keys)[]) {
    const key = keys[kind];
    for (const name of diff[kind].added) result.set(`${key}:${name}`, "added");
    for (const name of diff[kind].removed) result.set(`${key}:${name}`, "removed");
    for (const each of diff[kind].changed) result.set(`${key}:${each.name}`, "changed");
  }
  const { before, after } = diff;
  // Compare by service, not by changed names: two modules may share a display name.
  const facts = (module: MapModule) =>
    JSON.stringify([module.name, module.kind, module.package ?? null, module.path ?? null]);
  for (const module of after.modules) {
    const prior = before.modules.find((each) => each.service === module.service);
    if (prior === undefined) result.set(`module:${module.service}`, "added");
    else if (facts(prior) !== facts(module)) result.set(`module:${module.service}`, "changed");
  }
  for (const module of before.modules)
    if (!after.modules.some((each) => each.service === module.service))
      result.set(`module:${module.service}`, "removed");
  return result;
};

const cells = (field: MapFieldChange): string =>
  field.added === undefined || field.removed === undefined
    ? `<td class="old">${esc(field.before)}</td><td class="new">${esc(field.after)}</td>`
    : `<td class="old">${field.removed.map((item) => `<span>− ${esc(item)}</span>`).join("<br>")}</td><td class="new">${field.added.map((item) => `<span>+ ${esc(item)}</span>`).join("<br>")}</td>`;

const changesHtml = (diff: MapDiff): string => {
  const details = mapDiffKinds.flatMap((kind) => {
    const { added, removed, changed } = diff[kind];
    if (added.length + removed.length + changed.length === 0) return [];
    const rows = [
      ...added.map(
        (name) =>
          `<tr class="is-added"><th scope="row"><code>${esc(name)}</code></th><td><span class="mark mark-added">added</span></td><td></td><td></td></tr>`,
      ),
      ...removed.map(
        (name) =>
          `<tr class="is-removed"><th scope="row"><code>${esc(name)}</code></th><td><span class="mark mark-removed">removed</span></td><td></td><td></td></tr>`,
      ),
      ...changed.flatMap((each) =>
        each.fields.map(
          (field) =>
            `<tr class="is-changed"><th scope="row"><code>${esc(each.name)}</code></th><td>${esc(field.field)}</td>${cells(field)}</tr>`,
        ),
      ),
    ];
    return [
      `<h3>${esc(kind.charAt(0).toUpperCase() + kind.slice(1))}</h3><div class="table-wrap"><table><colgroup><col class="name"><col class="field"><col><col></colgroup><thead><tr><th scope="col">Name</th><th scope="col">Change</th><th scope="col">Before, or items removed</th><th scope="col">After, or items added</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
    ];
  });
  return `<section class="changes" aria-labelledby="changes"><h2 id="changes">What changed</h2><ul class="summary">${mapDiffSummary(
    diff,
  )
    .map((line) => `<li>${esc(line)}</li>`)
    .join("")}</ul>${details.join("")}</section>`;
};

export const renderMapDiff = (diff: MapDiff, format: "text" | "html"): string =>
  format === "text"
    ? mapDiffText(diff)
    : appMapHtml(merged(diff.before, diff.after), {
        title: "App map change",
        lead: "The after map, with removed items kept in place. Green is added, red is removed, amber is changed.",
        marks: marks(diff),
        before: changesHtml(diff),
      });

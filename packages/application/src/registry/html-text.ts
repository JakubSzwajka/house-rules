export const esc = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const code = (value: string): string => `<code>${esc(value)}</code>`;

export const badge = (kind: string, label: string): string =>
  `<span class="badge badge-${kind}">${esc(label)}</span>`;

export type Mark = "added" | "removed" | "changed";

export const markLabel = (mark: Mark | undefined): string =>
  mark === undefined ? "" : ` <span class="mark mark-${mark}">${mark}</span>`;

export const markClass = (mark: Mark | undefined): string =>
  mark === undefined ? "" : ` is-${mark}`;

export const scriptJson = (value: unknown): string =>
  // Escaping < keeps JSON inside a script element from closing it early.
  JSON.stringify(value).replaceAll("<", "\\u003c");

export const list = (values: readonly string[], empty = "none"): string =>
  values.length === 0 ? `<span class="muted">${esc(empty)}</span>` : values.map(code).join(" ");

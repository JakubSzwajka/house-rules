export interface Frontmatter {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const FENCE = /^\s*(```|~~~)/;
const INLINE_LINK = /(!?\[[^\]]*\])\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;
const DEFINITION = /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return String(JSON.parse(trimmed));
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
};

export const parseFrontmatter = (text: string): Frontmatter => {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    return { fields: {}, body: text };
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (field?.[1] !== undefined && field[2] !== undefined && field[2] !== "") {
      fields[field[1]] = unquote(field[2]);
    }
  }
  return { fields, body: text.slice(match[0].length) };
};

export const yamlString = (value: string): string => JSON.stringify(value);

export const firstHeading = (body: string): string | undefined =>
  /^#\s+(.+)$/m.exec(body)?.[1]?.trim();

export const withoutFirstHeading = (body: string): string =>
  body.replace(/^#\s+.+\n+/m, "").trimStart();

const mapOutsideCode = (markdown: string, mapLine: (line: string) => string): string => {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker !== undefined) {
        fence = fence === undefined ? marker : fence === marker ? undefined : fence;
        return line;
      }
      return fence === undefined ? mapLine(line) : line;
    })
    .join("\n");
};

export const demoteHeadings = (markdown: string, levels: number): string =>
  mapOutsideCode(markdown, (line) =>
    line.replace(
      /^(#{1,6})(\s)/,
      (_, hashes: string, space: string) =>
        `${"#".repeat(Math.min(6, hashes.length + levels))}${space}`,
    ),
  );

const codeSpans = (line: string): readonly (readonly [number, number])[] =>
  [...line.matchAll(/`[^`]*`/g)].map((match) => [match.index, match.index + match[0].length]);

export const rewriteLinks = (
  markdown: string,
  mapTarget: (target: string) => string | undefined,
): string =>
  mapOutsideCode(markdown, (line) => {
    const definition = DEFINITION.exec(line);
    if (definition?.[1] !== undefined && definition[2] !== undefined) {
      return `${definition[1]}${mapTarget(definition[2]) ?? definition[2]}${definition[3] ?? ""}`;
    }
    const spans = codeSpans(line);
    return line.replace(
      INLINE_LINK,
      (whole, label: string, target: string, title: string, offset: number) =>
        spans.some(([start, end]) => offset > start && offset < end)
          ? whole
          : `${label}(${mapTarget(target) ?? target}${title})`,
    );
  });

export const isRelativeTarget = (target: string): boolean =>
  target !== "" &&
  !target.startsWith("#") &&
  !target.startsWith("//") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
  !target.includes("{");

export const splitTarget = (target: string): { readonly path: string; readonly hash: string } => {
  const index = target.search(/[#?]/);
  return index === -1
    ? { path: target, hash: "" }
    : { path: target.slice(0, index), hash: target.slice(index) };
};

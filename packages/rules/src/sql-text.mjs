// Reads table names out of SQL text, and SQL text out of TypeScript source, without a parser.
const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|[A-Za-z_][\w$]*)`;
const IDENTIFIER_PART = new RegExp(IDENTIFIER, "gu");
const NAME = String.raw`(${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})*)`;
export const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:(?:temporary|temp|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}`,
  "giu",
);
export const REFERENCES = new RegExp(String.raw`\breferences\s+${NAME}`, "giu");
const TOUCHES = new RegExp(
  String.raw`\b(?:from|join|into|update|using|(?:alter|drop)\s+table(?:\s+if\s+exists)?|truncate(?:\s+table)?)\s+(?:only\s+)?${NAME}`,
  "giu",
);

const NOT_AN_ALIAS =
  "as|where|join|inner|left|right|full|cross|natural|outer|on|using|group|order|limit|offset|having|window|union|intersect|except|set|returning|for|lateral|values|select|default|tablesample|fetch|into|from|with|when|do|cascade|restrict|only";
// After a table in a from list: call arguments, an alias with its column list, a comma, then the next table.
const NEXT_IN_LIST = new RegExp(
  String.raw`\s*(?:\([^()]*\))?(?:\s+(?:as\s+)?(?!(?:${NOT_AN_ALIAS})\b)${IDENTIFIER}(?:\s*\([^()]*\))?)?\s*,\s*(?:only\s+)?${NAME}`,
  "iuy",
);
const SQL_STATEMENT = /\b(?:select|insert|update|delete|alter|drop|truncate|merge)\b/iu;

export const tableName = (raw) => {
  const last = raw.match(IDENTIFIER_PART).at(-1);
  const quote = last[0];
  const bare =
    quote === '"' || quote === "\x60" ? last.slice(1, -1).replaceAll(quote + quote, quote) : last;
  return bare.toLowerCase();
};

// Every table a SQL text names after from, join, into, update, using, or alter, drop and truncate table, comma-listed tables included.
export const tableReferences = (sql) => {
  const references = [];
  for (const match of sql.matchAll(TOUCHES)) {
    references.push({ name: match[1], index: match.index + match[0].length - match[1].length });
    NEXT_IN_LIST.lastIndex = match.index + match[0].length;
    for (let next = NEXT_IN_LIST.exec(sql); next !== null; next = NEXT_IN_LIST.exec(sql)) {
      references.push({ name: next[1], index: next.index + next[0].length - next[1].length });
    }
  }
  return references;
};

const blank = (text, fill = " ") => text.replace(/[^\n]/gu, fill);

// Blanks SQL comments and string literals, keeping offsets so line numbers stay true. Quoted identifiers stay.
export const blankSql = (sql) => {
  let out = "";
  let index = 0;
  const closing = (quote, from, backslashes) => {
    let end = from;
    while (end < sql.length) {
      if (backslashes && sql[end] === "\\") end += 2;
      else if (sql[end] !== quote) end += 1;
      else if (sql[end + 1] === quote) end += 2;
      else return end + 1;
    }
    return sql.length;
  };
  while (index < sql.length) {
    const character = sql[index];
    const pair = sql.slice(index, index + 2);
    let end = index + 1;
    let keep = true;
    if (pair === "--" || pair === "/*") {
      const close = sql.indexOf(pair === "--" ? "\n" : "*/", index + 2);
      end = close === -1 ? sql.length : close + (pair === "--" ? 0 : 2);
      keep = false;
    } else if (character === "'") {
      const escapeString = /(?:^|[^\w$])[eE]$/u.test(sql.slice(Math.max(0, index - 2), index));
      end = closing("'", index + 1, escapeString);
      keep = false;
    } else if (character === '"' || character === "\x60") {
      end = closing(character, index + 1, false);
    }
    const text = sql.slice(index, Math.min(end, sql.length));
    out += keep ? text : blank(text);
    index = end;
  }
  return out;
};

// Decodes a JavaScript string's escapes. `at[i]` is the source offset of decoded character i.
const decodeString = (text, start) => {
  let decoded = "";
  const at = [];
  for (let index = 0; index < text.length; ) {
    const escape =
      text[index] === "\\"
        ? /^\\(?:u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|[\s\S])/u.exec(
            text.slice(index, index + 12),
          )
        : null;
    const character = escape === null ? text[index] : escape[0][1];
    if (escape === null) decoded += character;
    else if (escape[0].length > 2 || "tvfb0".includes(character)) decoded += " ";
    else decoded += character === "n" || character === "r" ? "\n" : character;
    at.push(start + index);
    index += escape === null ? 1 : escape[0].length;
  }
  return { decoded, at };
};

// One SQL text per string literal, or per template literal with each `${...}` read as `?`.
export const sqlTexts = (sql) => {
  const groups = new Map();
  for (const part of sql) {
    const key = part.template ?? part;
    groups.set(key, [...(groups.get(key) ?? []), part]);
  }
  return [...groups.values()].map((parts) => {
    let text = "";
    const at = [];
    for (const [position, part] of parts.entries()) {
      if (position > 0) {
        text += "?";
        at.push(part.start);
      }
      const { decoded, at: offsets } = decodeString(part.text, part.start);
      text += decoded;
      at.push(...offsets);
    }
    return { text: blankSql(text), at };
  });
};

// Splits TypeScript into string-literal text and code, with offsets. `sql` keeps the strings and template literals that hold a SQL keyword.
export const lexSource = (source) => {
  const strings = [];
  const code = [];
  const braces = [];
  let index = 0;
  let codeStart = 0;
  const flushCode = (end) => {
    if (end > codeStart) code.push({ text: source.slice(codeStart, end), start: codeStart });
  };
  let templates = 0;
  const readTemplate = (template) => {
    const start = index;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
      } else if (character === "`") {
        strings.push({ text: source.slice(start, index), start, template });
        index += 1;
        return;
      } else if (character === "$" && source[index + 1] === "{") {
        strings.push({ text: source.slice(start, index), start, template });
        index += 2;
        braces.push(template);
        return;
      } else {
        index += 1;
      }
    }
    strings.push({ text: source.slice(start), start, template });
  };
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      flushCode(index);
      index = source.indexOf("\n", index);
      if (index === -1) index = source.length;
      codeStart = index;
    } else if (character === "/" && next === "*") {
      flushCode(index);
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      codeStart = index;
    } else if (character === '"' || character === "'") {
      flushCode(index);
      const start = index + 1;
      index = start;
      while (index < source.length && source[index] !== character && source[index] !== "\n") {
        index += source[index] === "\\" ? 2 : 1;
      }
      strings.push({ text: source.slice(start, index), start });
      index += 1;
      codeStart = index;
    } else if (character === "`") {
      flushCode(index);
      index += 1;
      templates += 1;
      readTemplate(templates);
      codeStart = index;
    } else if (character === "{") {
      braces.push("code");
      index += 1;
    } else if (character === "}" && typeof braces.at(-1) === "number") {
      flushCode(index);
      const template = braces.pop();
      index += 1;
      readTemplate(template);
      codeStart = index;
    } else {
      if (character === "}") braces.pop();
      index += 1;
    }
  }
  flushCode(source.length);
  const sqlTemplates = new Set(
    strings
      .filter((part) => part.template && SQL_STATEMENT.test(part.text))
      .map((part) => part.template),
  );
  const sql = strings.filter((part) =>
    part.template ? sqlTemplates.has(part.template) : SQL_STATEMENT.test(part.text),
  );
  return { strings, sql, code };
};

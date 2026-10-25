const wordStart = /[A-Za-z_\u0080-\uffff]/u;
const wordPart = /[A-Za-z_0-9$\u0080-\uffff]/u;
const operator = /[+*/<>=~!@#%^&|`?\-]/u;

// PostgreSQL REL_18_STABLE src/backend/parser/scan.l: space, identifier,
// dolqdelim and x[bhenus]start. Offsets include comments and quoted names.
export const sqlTokens = (text, { parameters = false, asciiOnly = false } = {}) => {
  const tokens = [];
  let i = 0;
  const ascii = (start, end) => {
    if (asciiOnly && /[^\x00-\x7f]/u.test(text.slice(start, end)))
      throw new Error("non-ASCII SQL outside string or quoted identifier is not supported");
  };
  const add = (kind, value, start) => {
    if (!["string", "identifier"].includes(kind)) ascii(start, i);
    tokens.push({ kind, value, index: start });
  };
  while (i < text.length) {
    const start = i;
    const c = text[i];
    if (/[ \t\n\r\f\v]/u.test(c)) {
      i += 1;
      continue;
    }
    if (text.startsWith("--", i)) {
      const end = text.slice(i + 2).search(/[\n\r]/u);
      i = end < 0 ? text.length : i + 2 + end;
      ascii(start, i);
      continue;
    }
    if (text.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth) {
        if (text.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (text.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      if (depth) throw new Error("unclosed SQL comment");
      ascii(start, i);
      continue;
    }
    const escaped = /[eE]/u.test(c) && text[i + 1] === "'";
    const prefixed = /[bBxXnNeE]/u.test(c) && text[i + 1] === "'";
    const unicode = /[uU]/u.test(c) && text[i + 1] === "&" && ["'", '"'].includes(text[i + 2]);
    if (c === '"' || c === "'" || prefixed || unicode) {
      const quote = unicode ? text[i + 2] : prefixed ? "'" : c;
      let value = "";
      i += unicode ? 3 : prefixed ? 2 : 1;
      let closed = false;
      while (i < text.length) {
        if (escaped && text[i] === "\\") {
          if (i + 1 >= text.length) throw new Error("unclosed SQL quote");
          value += text[i + 1];
          i += 2;
        } else if (
          asciiOnly &&
          quote === "'" &&
          (c === "'" || /[nN]/u.test(c)) &&
          text[i] === "\\"
        ) {
          throw new Error(
            "backslash in plain/N SQL string is not supported; use E strings or dollar quotes",
          );
        } else if (text[i] !== quote) value += text[i++];
        else if (text[i + 1] === quote) {
          value += quote;
          i += 2;
        } else {
          i += 1;
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("unclosed SQL quote");
      if (unicode && quote === '"' && (asciiOnly || value.includes("\\")))
        throw new Error("Unicode-escaped SQL identifier is not supported");
      add(quote === '"' ? "identifier" : "string", value, start);
    } else if (
      c === "$" &&
      /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z_0-9\u0080-\uffff]*)?\$/u.test(text.slice(i))
    ) {
      const delimiter = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z_0-9\u0080-\uffff]*)?\$/u.exec(
        text.slice(i),
      )[0];
      ascii(i, i + delimiter.length);
      const end = text.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new Error("unclosed SQL dollar quote");
      add("string", text.slice(i + delimiter.length, end), i);
      i = end + delimiter.length;
    } else if (wordStart.test(c)) {
      while (i < text.length && wordPart.test(text[i])) i += 1;
      add("word", text.slice(start, i).toLowerCase(), start);
    } else if (/[0-9]/u.test(c)) {
      while (i < text.length && /[0-9]/u.test(text[i])) i += 1;
      if (text[i] === "." && /[0-9]/u.test(text[i + 1] ?? "")) {
        i += 1;
        while (i < text.length && /[0-9]/u.test(text[i])) i += 1;
      }
      add("number", text.slice(start, i), start);
    } else if (parameters && c === "\u0000") {
      add("parameter", c, i++);
    } else if (c === "?" && !operator.test(text[i + 1] ?? "")) {
      add("parameter", c, i++);
    } else if (operator.test(c)) {
      i += 1;
      while (
        i < text.length &&
        operator.test(text[i]) &&
        !text.startsWith("--", i) &&
        !text.startsWith("/*", i)
      )
        i += 1;
      if (!/[~!@#%^&|`?]/u.test(text.slice(start, i)))
        while (i > start + 1 && /[+\-]/u.test(text[i - 1])) i -= 1;
      add("symbol", text.slice(start, i), start);
    } else if ("(),.;:[]".includes(c)) {
      add("symbol", c, i++);
    } else throw new Error(`unsupported SQL token at ${i + 1}`);
    if (tokens.length > 10000) throw new Error("SQL exceeds 10000 tokens");
  }
  return tokens;
};

export const sqlStatements = (tokens) => {
  const statements = [];
  let current = [];
  for (const token of tokens) {
    if (token.kind === "symbol" && token.value === ";") {
      if (current.length) statements.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) statements.push(current);
  return statements;
};

export const tokenWord = (token, value) => token?.kind === "word" && token.value === value;
export const tokenName = (token) => ["word", "identifier"].includes(token?.kind);

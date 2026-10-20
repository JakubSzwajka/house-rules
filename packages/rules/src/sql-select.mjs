import { sqlTokens, tokenName } from "./sql-tokens.mjs";
import { sqlSettingsProblems } from "./sql-settings.mjs";

const reserved = new Set(
  (
    "select with recursive as from join inner left right full cross outer natural on using where " +
    "group by having order asc desc nulls first last limit offset union all distinct intersect except " +
    "for into table values insert update delete merge create alter drop truncate call copy execute " +
    "and or not is null true false in like ilike between exists case when then else end lateral " +
    "tablesample window fetch returning only current_user session_user current_role current_catalog " +
    "current_schema current_date current_time current_timestamp localtime localtimestamp user system_user"
  ).split(" "),
);
const binary = new Map([
  ["or", 1],
  ["and", 2],
  ["=", 3],
  ["<>", 3],
  ["!=", 3],
  ["<", 3],
  [">", 3],
  ["<=", 3],
  [">=", 3],
  ["like", 3],
  ["ilike", 3],
  ["+", 4],
  ["-", 4],
  ["*", 5],
  ["/", 5],
  ["%", 5],
]);

export const selectRelations = (input) => {
  if (typeof input === "string") {
    const problems = sqlSettingsProblems([], input);
    if (problems.length) throw new Error(problems.join("; "));
  }
  const tokens = typeof input === "string" ? sqlTokens(input, { asciiOnly: true }) : input;
  let i = 0;
  let depth = 0;
  const relations = [];
  const is = (value) => ["word", "symbol"].includes(tokens[i]?.kind) && tokens[i]?.value === value;
  const eat = (value) => {
    if (!is(value)) return false;
    i += 1;
    return true;
  };
  const fail = (message = "unsupported SELECT grammar") => {
    throw new Error(`${message} at token ${i + 1}`);
  };
  const need = (value) => {
    if (!eat(value)) fail(`expected ${value}`);
  };
  const identifier = () => {
    const token = tokens[i];
    if (!tokenName(token) || (token.kind === "word" && reserved.has(token.value)))
      fail("expected identifier");
    i += 1;
    return token;
  };
  const list = (read) => {
    read();
    while (eat(",")) read();
  };
  const alias = () => {
    if (eat("as")) identifier();
    else if (
      tokens[i]?.kind === "identifier" ||
      (tokens[i]?.kind === "word" && !reserved.has(tokens[i].value))
    )
      identifier();
  };
  const nested = (work) => {
    depth += 1;
    if (depth > 32) fail("SQL nesting exceeds 32");
    work();
    depth -= 1;
  };
  const expression = (ctes, min = 0, parameter = false) =>
    nested(() => {
      if (eat("not") || eat("+") || eat("-")) expression(ctes, 6, parameter);
      else if (eat("exists")) {
        need("(");
        query(ctes);
        need(")");
      } else if (eat("(")) {
        if (is("select") || is("with")) query(ctes);
        else expression(ctes, 0, parameter);
        need(")");
      } else if (tokens[i]?.kind === "parameter") {
        if (!parameter)
          fail("parameters may supply comparison values or bounds, not SQL structure");
        i += 1;
      } else if (["string", "number"].includes(tokens[i]?.kind)) i += 1;
      else if (eat("null") || eat("true") || eat("false") || eat("*")) {
        /* terminal */
      } else {
        identifier();
        if (eat(".")) {
          if (!eat("*")) identifier();
        }
        if (is("(")) fail("SQL functions are not allowed");
      }
      while (i < tokens.length) {
        if (is("is") && min <= 3) {
          i += 1;
          eat("not");
          if (!(eat("null") || eat("true") || eat("false"))) fail("expected null or boolean");
        } else if ((is("in") || is("between") || is("not")) && min <= 3) {
          eat("not");
          if (eat("in")) {
            need("(");
            if (is("select") || is("with")) query(ctes);
            else list(() => expression(ctes, 0, true));
            need(")");
          } else if (eat("between")) {
            expression(ctes, 4, true);
            need("and");
            expression(ctes, 4, true);
          } else if (eat("like") || eat("ilike")) expression(ctes, 4, true);
          else fail();
        } else {
          const precedence = ["word", "symbol"].includes(tokens[i]?.kind)
            ? binary.get(tokens[i]?.value)
            : undefined;
          if (precedence === undefined || precedence < min) break;
          i += 1;
          expression(ctes, precedence + 1, precedence === 3 || parameter);
        }
      }
    });
  const relation = (ctes) => {
    if (eat("(")) {
      if (!is("select") && !is("with")) fail("parenthesized table joins are not allowed");
      query(ctes);
      need(")");
      alias();
      return;
    }
    const name = identifier();
    if (is(".")) fail("schema-qualified relations are not allowed");
    if (is("(")) fail("SQL functions are not allowed");
    if (!ctes.has(name.value)) relations.push({ name: name.value, index: name.index });
    alias();
  };
  const query = (outer) =>
    nested(() => {
      const ctes = new Set(outer);
      if (eat("with")) {
        if (is("recursive")) fail("recursive WITH is not supported");
        list(() => {
          const name = identifier().value;
          if (ctes.has(name)) fail("duplicate CTE name");
          if (eat("(")) {
            list(identifier);
            need(")");
          }
          need("as");
          need("(");
          query(ctes);
          need(")");
          ctes.add(name);
        });
      }
      need("select");
      if (!eat("distinct")) eat("all");
      list(() => {
        expression(ctes);
        alias();
      });
      if (eat("from")) {
        relation(ctes);
        while (true) {
          if (eat(",")) {
            relation(ctes);
            continue;
          }
          if (eat("cross")) {
            need("join");
            relation(ctes);
            continue;
          }
          const typed = eat("inner") || eat("left") || eat("right") || eat("full");
          if (typed) eat("outer");
          if (!eat("join")) {
            if (typed) fail();
            break;
          }
          relation(ctes);
          if (eat("on")) expression(ctes);
          else {
            need("using");
            need("(");
            list(identifier);
            need(")");
          }
        }
      }
      if (eat("where")) expression(ctes);
      if (eat("group")) {
        need("by");
        list(() => expression(ctes));
      }
      if (eat("having")) expression(ctes);
      if (eat("order")) {
        need("by");
        list(() => {
          expression(ctes);
          if (!eat("asc")) eat("desc");
          if (eat("nulls") && !(eat("first") || eat("last"))) fail();
        });
      }
      for (const clause of ["limit", "offset"]) {
        if (!eat(clause)) continue;
        if (!["number", "parameter"].includes(tokens[i]?.kind)) fail("expected numeric bound");
        i += 1;
      }
    });
  query(new Set());
  eat(";");
  if (i !== tokens.length) fail("only one SELECT or WITH SELECT is allowed");
  return relations;
};

export const selectProblems = (input, allowed, label = "known published view") => {
  try {
    return selectRelations(input).flatMap(({ name }) =>
      allowed.has(name) ? [] : [`SQL names "${name}", not a ${label}.`],
    );
  } catch (error) {
    return [
      `SQL must contain exactly one SELECT or WITH SELECT in the supported grammar: ${error.message}.`,
    ];
  }
};

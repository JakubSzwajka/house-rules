import { sqlStatements, sqlTokens, tokenName, tokenWord } from "./sql-tokens.mjs";
import { selectProblems } from "./sql-select.mjs";
import { migrationChunks } from "./migration-chunks.mjs";
import { sqlSettingsProblems } from "./sql-settings.mjs";

export const viewDdl = (sql) => {
  const objects = [];
  const changes = [];
  const problems = [];
  let statements;
  try {
    statements = migrationChunks(sql).flatMap((chunk) => {
      const parts = sqlStatements(sqlTokens(chunk, { asciiOnly: true }));
      problems.push(...sqlSettingsProblems(parts, chunk));
      return parts;
    });
  } catch (error) {
    return { objects, changes, problems: [error.message] };
  }
  for (const tokens of statements) {
    let i = 0;
    const is = (word) => tokenWord(tokens[i], word);
    const eat = (word) => {
      if (!is(word)) return false;
      i += 1;
      return true;
    };
    const symbol = (value) => tokens[i]?.kind === "symbol" && tokens[i]?.value === value;
    const name = () => {
      if (!tokenName(tokens[i])) return undefined;
      const token = tokens[i++];
      if (symbol(".")) return undefined;
      return token;
    };
    if (eat("create")) {
      const replace = eat("or");
      if (replace && !eat("replace")) {
        problems.push("unsupported CREATE OR syntax");
        continue;
      }
      const temporary = eat("temporary") || eat("temp");
      const recursive = eat("recursive");
      const materialized = eat("materialized");
      if (!eat("view")) continue;
      if (materialized && (replace || temporary)) {
        problems.push("unsupported materialized view modifiers");
        continue;
      }
      if (eat("if") && !(materialized && eat("not") && eat("exists"))) {
        problems.push("unsupported VIEW IF syntax");
        continue;
      }
      const target = name();
      if (!target || ["if", "as"].some((word) => tokenWord(target, word))) {
        problems.push("view must have an unqualified static object name");
        continue;
      }
      if (recursive) {
        problems.push("recursive CREATE VIEW is not supported");
        continue;
      }
      if (symbol("(")) {
        i += 1;
        while (name()) {
          if (!symbol(",")) break;
          i += 1;
        }
        if (!symbol(")")) {
          problems.push("unsupported view column list");
          continue;
        }
        i += 1;
      }
      if (!eat("as")) {
        problems.push("view requires AS SELECT in the supported grammar");
        continue;
      }
      let end = tokens.length;
      if (
        !materialized &&
        tokenWord(tokens[end - 1], "option") &&
        tokenWord(tokens[end - 2], "check")
      ) {
        const modifier =
          tokenWord(tokens[end - 3], "local") || tokenWord(tokens[end - 3], "cascaded");
        const withIndex = end - (modifier ? 4 : 3);
        if (tokenWord(tokens[withIndex], "with")) end = withIndex;
      }
      objects.push({ name: target.value, index: target.index, query: tokens.slice(i, end) });
    } else if (eat("alter") || eat("drop")) {
      const materialized = eat("materialized");
      const table = !is("view") && !materialized;
      if (!(eat("view") || (table && eat("table")))) continue;
      if (eat("if") && !eat("exists")) {
        problems.push("unsupported ALTER/DROP IF syntax");
        continue;
      }
      if (table) eat("only");
      while (true) {
        const target = name();
        if (!target) {
          problems.push("ALTER/DROP requires an unqualified static object name");
          break;
        }
        changes.push({ name: target.value, index: target.index });
        if (!symbol(",")) break;
        i += 1;
      }
    }
  }
  return { objects, changes, problems };
};

export const viewQueryProblems = (view, allowed) =>
  selectProblems(view.query, allowed, "module-owned table or view");

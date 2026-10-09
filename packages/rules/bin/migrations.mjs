#!/usr/bin/env node
import * as fs from "node:fs";
import path from "node:path";
import { seeRuleLine } from "../src/rule-docs.mjs";
import { checkModuleList, LIST_FILE } from "../src/module-list.mjs";
import {
  CREATE_TABLE,
  blankSql,
  lexSource,
  REFERENCES,
  sqlTexts,
  tableName,
  tableReferences,
} from "../src/sql-text.mjs";

const DEFAULT_WORKSPACES = ["apps/*", "packages/*"];
const WORKSPACE_LIST_ITEM = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/u;
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/u;
const SKIPPED_DIRECTORY = (name) => name === "node_modules" || name.startsWith(".");
const OPENS_TRANSACTION_CALL = /\bwithTransaction\b/u;
// In SQL text, any statement that starts with begin or start transaction, in any case. The text is blanked
// first, in one scan: comments, strings and dollar-quoted bodies, so the BEGIN of a DO $$ ... $$ block passes.
const STARTS_TRANSACTION = /(?:^|;)\s*(begin|start\s+transaction)\b/iu;
// SQL text: a template tagged like sql, or the text of a raw query call.
const SQL_TAG = /[\w$]*sql[\w$]*\s*$/iu;
const RAW_QUERY_CALL = /\.\s*(?:unsafe|execute|executeUnprepared|executeRaw|query)\s*\(\s*$/u;
// In a use-case, any string that starts with begin fails, as before. Any other string fails only when
// the whole string is a transaction statement, so UI text such as "Begin" or "Begin your trip" passes.
const STARTS_WITH_TRANSACTION = /^\s*(?:begin|start\s+transaction)\b/iu;
const WHOLE_TRANSACTION_STRING =
  /^\s*(?:begin|BEGIN|start\s+transaction|START\s+TRANSACTION)(?:\s+(?:transaction|work|isolation|read|TRANSACTION|WORK|ISOLATION|READ)\b[^;]*)?\s*;?\s*$/u;
const OPENS_UNIT = /\b[Uu]nitOfWork\s*\.\s*atomic\b/u;
const TEST_SOURCE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/u;
// A UnitOfWork adapter and the migration runner may open a raw transaction. --adapter-package adds more.
const DEFAULT_ADAPTER_PACKAGES = ["@house-rules/capability", "@house-rules/migrations"];
const ADAPTER_FLAG = "--adapter-package";

const adapterPackages = (args) => {
  const names = new Set(DEFAULT_ADAPTER_PACKAGES);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const name = arg.startsWith(`${ADAPTER_FLAG}=`)
      ? arg.slice(ADAPTER_FLAG.length + 1)
      : arg === ADAPTER_FLAG
        ? args[++index]
        : undefined;
    if (name === undefined || name === "" || name.startsWith("-")) {
      console.error(
        `migrations: unknown argument "${arg}". Usage: house-rules-migrations [${ADAPTER_FLAG} <package name>]...`,
      );
      process.exit(1);
    }
    names.add(name);
  }
  return names;
};

const adapters = adapterPackages(process.argv.slice(2));

const relative = (file) => path.relative(process.cwd(), file).split(path.sep).join("/");

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

const workspacePatterns = () => {
  if (!fs.existsSync("pnpm-workspace.yaml")) return DEFAULT_WORKSPACES;
  const lines = fs.readFileSync("pnpm-workspace.yaml", "utf8").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  const patterns = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const item = WORKSPACE_LIST_ITEM.exec(line);
    if (item === null) break;
    patterns.push(item[1]);
  }
  return patterns.length > 0 ? patterns : DEFAULT_WORKSPACES;
};

const workspaceDirectories = () =>
  fs
    .globSync(workspacePatterns().map((pattern) => `${pattern}/package.json`))
    .map((manifest) => path.dirname(manifest).split(path.sep).join("/"))
    .sort();

const walk = (directory, keep) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORY(entry.name) ? [] : walk(full, keep);
    return entry.isFile() && keep(entry.name) ? [full] : [];
  });
};

const problems = [];
const report = (file, line, message) => problems.push(`  ${relative(file)}:${line}: ${message}`);

const workspaces = workspaceDirectories();
const migrationFolders = new Map(workspaces.map((dir) => [path.resolve(dir, "migrations"), dir]));
const migrations = [];
const moduleList = checkModuleList(workspaces);

const TEST_FOLDERS = new Set(["fixtures", "tests"]);

// A .sql file under a fixtures/ or tests/ folder inside a workspace package is test data, not a migration.
const isTestData = (file) =>
  workspaces.some((workspace) => {
    const inside = path.relative(path.resolve(workspace), file);
    if (inside.startsWith("..") || path.isAbsolute(inside)) return false;
    return inside
      .split(path.sep)
      .slice(0, -1)
      .some((folder) => TEST_FOLDERS.has(folder));
  });

for (const file of walk(process.cwd(), (name) => name.endsWith(".sql"))) {
  const owner = migrationFolders.get(path.dirname(file));
  if (owner === undefined && isTestData(file)) continue;
  if (owner === undefined) {
    report(
      file,
      1,
      "this SQL file sits outside a `<package>/migrations/` folder. Move it into the migrations folder of the package that owns its tables.",
    );
  } else {
    migrations.push({ file, owner, sql: blankSql(fs.readFileSync(file, "utf8")) });
  }
}

for (const { file, owner } of moduleList.installedMigrations) {
  migrations.push({ file, owner, sql: blankSql(fs.readFileSync(file, "utf8")) });
}
for (const problem of moduleList.problems) report(path.resolve(LIST_FILE), 1, problem);

migrations.sort((a, b) => a.file.localeCompare(b.file));
const owners = new Map();
for (const { file, owner, sql } of migrations) {
  for (const match of sql.matchAll(CREATE_TABLE)) {
    const table = tableName(match[1]);
    const creators = owners.get(table) ?? [];
    if (creators.length > 0 && !creators.includes(owner)) {
      report(
        file,
        lineAt(sql, match.index),
        `table "${table}" is already created by ${creators[0]}. A table has one owning package.`,
      );
    }
    if (!creators.includes(owner)) owners.set(table, [...creators, owner]);
  }
}

// A table that two packages create counts as owned by both, so the duplicate is the only report.
const foreignOwner = (table, owner) => {
  const creators = owners.get(tableName(table));
  return creators !== undefined && !creators.includes(owner) ? creators[0] : undefined;
};

for (const { file, owner, sql } of migrations) {
  for (const match of sql.matchAll(REFERENCES)) {
    const other = foreignOwner(match[1], owner);
    if (other === undefined) continue;
    report(
      file,
      lineAt(sql, match.index),
      `foreign key to "${tableName(match[1])}", a table ${other} owns. No cross-module foreign keys: keep the id as a plain column and ask ${other}'s service for the record.`,
    );
  }
  for (const { name, index } of tableReferences(sql)) {
    const other = foreignOwner(name, owner);
    if (other === undefined) continue;
    report(
      file,
      lineAt(sql, index),
      `touches "${tableName(name)}", a table ${other} owns. A migration changes only its own package's tables.`,
    );
  }
}

const packageName = (workspace) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")).name;
  } catch {
    return undefined;
  }
};

// The source offset of the first match of pattern in parts, or undefined.
const firstMatch = (parts, pattern) => {
  for (const part of parts) {
    const match = pattern.exec(part.text);
    if (match !== null) return part.start + match.index;
  }
  return undefined;
};

// The source offset of the first statement in SQL text that opens a transaction, or undefined.
const firstTransactionStart = ({ strings, code }, inUseCase) => {
  const codeBefore = new Map(code.map((part) => [part.start + part.text.length, part.text]));
  const before = (part) => codeBefore.get(part.start - 1) ?? "";
  const isQuery = (part) => SQL_TAG.test(before(part)) || RAW_QUERY_CALL.test(before(part));
  // Only a template's first part sits right after its tag; later parts sit after a `${...}`.
  const seen = new Set();
  const tagged = new Set();
  for (const part of strings) {
    if (part.template === undefined || seen.has(part.template)) continue;
    seen.add(part.template);
    if (isQuery(part)) tagged.add(part.template);
  }
  const isSql = (part) => (part.template === undefined ? isQuery(part) : tagged.has(part.template));
  for (const { raw, at } of sqlTexts(strings.filter(isSql))) {
    // Quoted identifiers are blanked for this scan only; the table checks still read them.
    const match = STARTS_TRANSACTION.exec(
      blankSql(raw, { dollarQuotes: true, identifiers: false }),
    );
    if (match !== null) return at[match.index + match[0].length - match[1].length];
  }
  // In a use-case, main's floor holds for every string, SQL text included: any template part that
  // starts with begin after a `${...}` fails, even where the joined SQL text reads `?begin`.
  return inUseCase
    ? firstMatch(strings, STARTS_WITH_TRANSACTION)
    : firstMatch(
        strings.filter((part) => !isSql(part)),
        WHOLE_TRANSACTION_STRING,
      );
};

// SQL in one package's source may name only tables that package owns. Only an adapter package opens
// a raw transaction, and a module's own code never opens a unit of work: the use-case does.
const checkSource = (file, owner, { adapter, module, useCases }) => {
  const source = fs.readFileSync(file, "utf8");
  const lexed = lexSource(source);
  const { sql, code } = lexed;
  if (owners.size > 0) {
    for (const { text, at } of sqlTexts(sql)) {
      for (const { name, index } of tableReferences(text)) {
        const other = foreignOwner(name, owner);
        if (other === undefined) continue;
        report(
          file,
          lineAt(source, at[index]),
          `SQL names "${tableName(name)}", a table ${other} owns. A module's SQL touches only its own tables: call ${other}'s service, or move the table's migration into this package if it owns the table.`,
        );
      }
    }
  }
  if (adapter) return;
  const inUseCase = useCases !== undefined && file.startsWith(`${useCases}${path.sep}`);
  const raw = firstMatch(code, OPENS_TRANSACTION_CALL) ?? firstTransactionStart(lexed, inUseCase);
  if (raw !== undefined) {
    report(
      file,
      lineAt(source, raw),
      `opens a raw transaction. A use-case opens a unit of work instead: \`transactional: true\` on its contract, or \`UnitOfWork.atomic\` in its handler. Only a UnitOfWork adapter or a named adapter package (${ADAPTER_FLAG}) calls withTransaction or sends begin.`,
    );
  }
  const unit =
    module && !TEST_SOURCE.test(relative(file)) ? firstMatch(code, OPENS_UNIT) : undefined;
  if (unit !== undefined) {
    report(
      file,
      lineAt(source, unit),
      "a module opens a unit of work. A module never opens one: its writes run in the unit the use-case opened, and fail with NoOpenUnit without one. Move UnitOfWork.atomic into the use-case.",
    );
  }
};

const APP_ROOT = /^apps\//u;

for (const workspace of workspaces) {
  const options = {
    adapter: adapters.has(packageName(workspace)),
    module: !APP_ROOT.test(workspace),
    useCases: path.resolve(workspace, "src", "use-cases"),
  };
  for (const file of walk(path.resolve(workspace, "src"), (name) => SOURCE_FILE.test(name))) {
    checkSource(file, workspace, options);
  }
}

// A listed installed package ships its src/, and is held to the same rules.
for (const { owner, directory } of moduleList.installedSources) {
  for (const file of walk(directory, (name) => SOURCE_FILE.test(name))) {
    checkSource(file, owner, { adapter: adapters.has(owner), module: true });
  }
}

if (problems.length > 0) {
  console.error(
    `migrations: ${problems.length} problem(s) with module-owned SQL or the module list:`,
  );
  for (const problem of problems) console.error(problem);
  console.error(seeRuleLine("house-rules-migrations"));
  process.exit(1);
}

const ownerCount = new Set([...owners.values()].flat()).size;
console.log(
  migrations.length === 0
    ? "migrations: no SQL migrations found"
    : `migrations: ${owners.size} table(s) owned by ${ownerCount} package(s); no cross-module foreign keys or SQL; ${moduleList.listed} module(s) listed in ${LIST_FILE}`,
);

#!/usr/bin/env node
import * as fs from "node:fs";
import path from "node:path";
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
const OPENS_TRANSACTION_SQL = /^\s*(?:begin|start\s+transaction)\b/iu;

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

// SQL in one package's source may name only tables that package owns. Use-case rules apply to workspace packages.
const checkSource = (file, owner, useCases) => {
  const source = fs.readFileSync(file, "utf8");
  const { strings, sql, code } = lexSource(source);
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
  if (useCases === undefined || !file.startsWith(`${useCases}${path.sep}`)) return;
  const opening = [
    ...code.map((part) => ({ part, match: OPENS_TRANSACTION_CALL.exec(part.text) })),
    ...strings.map((part) => ({ part, match: OPENS_TRANSACTION_SQL.exec(part.text) })),
  ].find(({ match }) => match !== null);
  if (opening !== undefined) {
    report(
      file,
      lineAt(source, opening.part.start + opening.match.index),
      "a use-case opens a transaction. One module write method is one transaction; a read method may run without one. Move this work into a write method of the module's service.",
    );
  }
};

for (const workspace of workspaces) {
  const useCases = path.resolve(workspace, "src", "use-cases");
  for (const file of walk(path.resolve(workspace, "src"), (name) => SOURCE_FILE.test(name))) {
    checkSource(file, workspace, useCases);
  }
}

// A listed installed package ships its src/, and its SQL is held to the same own-tables rule.
for (const { owner, directory } of moduleList.installedSources) {
  for (const file of walk(directory, (name) => SOURCE_FILE.test(name))) {
    checkSource(file, owner, undefined);
  }
}

if (problems.length > 0) {
  console.error(
    `migrations: ${problems.length} problem(s) with module-owned SQL or the module list:`,
  );
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const ownerCount = new Set([...owners.values()].flat()).size;
console.log(
  migrations.length === 0
    ? "migrations: no SQL migrations found"
    : `migrations: ${owners.size} table(s) owned by ${ownerCount} package(s); no cross-module foreign keys or SQL; ${moduleList.listed} module(s) listed in ${LIST_FILE}`,
);

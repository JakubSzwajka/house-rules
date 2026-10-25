#!/usr/bin/env node
import * as fs from "node:fs";
import path from "node:path";
import { LAYOUT_CONFIG_FILE, readAppsRoot } from "../src/layout-config.mjs";
import { seeRuleLine } from "../src/rule-docs.mjs";
import { checkModuleList, LIST_FILE } from "../src/module-list.mjs";
import { lexSource, sqlTexts, tableName, tableReferences } from "../src/sql-text.mjs";
import { readModels } from "../src/read-models.mjs";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";
import { viewDdl } from "../src/sql-views.mjs";
import { migrationOwnership } from "../src/migration-ownership.mjs";
import { firstMatch, firstTransactionStart } from "../src/transaction-text.mjs";
import { workspaceDirectories } from "../src/workspaces.mjs";
import { migrationChunks } from "../src/migration-chunks.mjs";
import { sqlTokens } from "../src/sql-tokens.mjs";

const ownershipText = (chunk, nested = false) => {
  try {
    const tokens = sqlTokens(chunk, { asciiOnly: true });
    const text = chunk.split("").map((character) => (character === "\n" ? "\n" : " "));
    for (const token of tokens) {
      let index = token.index;
      let value = token.value;
      if (token.kind === "string") {
        if (chunk[index] !== "$") continue;
        const delimiter = chunk.slice(index, chunk.indexOf("$", index + 1) + 1);
        // Bodies get a lexical pass, not procedural or dynamic-SQL analysis.
        const body = nested ? undefined : ownershipText(token.value, true);
        if (body === undefined) value = `${delimiter}${token.value}${delimiter}`;
        else {
          index += delimiter.length;
          value = body;
        }
      } else if (token.kind === "identifier") value = `"${value.replaceAll('"', '""')}"`;
      for (let i = 0; i < value.length; i += 1) text[index + i] = value[i];
    }
    return text.join("");
  } catch {
    // Keep HEAD's raw-body heuristic when a procedural body cannot be lexed.
    // Top-level lexical failures are reported by viewDdl.
    return nested ? undefined : "";
  }
};
const ownershipSql = (raw) =>
  migrationChunks(raw)
    .map((chunk) => ownershipText(chunk))
    .join(";\n");

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/u;
const SKIPPED_DIRECTORY = (name) => name === "node_modules" || name.startsWith(".");
const OPENS_TRANSACTION_CALL = /\bwithTransaction\b/u;
const OPENS_UNIT = /\b[Uu]nitOfWork\s*\.\s*atomic\b/u;
const TEST_SOURCE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/u;
// A UnitOfWork adapter and the migration runner may open a raw transaction. --adapter-package adds more.
// Domain defines the unit of work, so its own UnitOfWork.atomic is not a module opening one.
const KITS = ["@house-rules/domain", "@house-rules/application"];
const DEFAULT_ADAPTER_PACKAGES = [...KITS, "@house-rules/migrations"];
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

const walk = (directory, keep) => {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORY(entry.name) ? [] : walk(full, keep);
    return entry.isFile() && keep(entry.name) ? [full] : [];
  });
};

const problems = [];
const report = (file, line, message) => problems.push(`  ${relative(file)}:${line}: ${message}`);

const APP_ROOT = (() => {
  try {
    return readAppsRoot(process.cwd());
  } catch (error) {
    console.error(
      `migrations: cannot read the apps roots from ${LAYOUT_CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
})();
const workspaces = workspaceDirectories();
const moduleList = checkModuleList(workspaces);
const folders = readModels(workspaces);
const migrationFolders = new Map(
  [...workspaces.map((dir) => [path.resolve(dir, "migrations"), dir])].map(([directory, owner]) => [
    fs.existsSync(directory) ? fs.realpathSync(directory) : directory,
    owner,
  ]),
);
for (const { directory } of folders) {
  if (fs.existsSync(path.join(directory, "migrations"))) {
    report(
      directory,
      1,
      "a read model has no migrations/ folder; modules publish the views it selects.",
    );
  }
}
const migrations = [];

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
  const owner = migrationFolders.get(fs.realpathSync(path.dirname(file)));
  if (owner === undefined && isTestData(file)) continue;
  if (owner === undefined) {
    report(
      file,
      1,
      "this SQL file sits outside a `<package>/migrations/` folder. Move it into the migrations folder of the package that owns its tables.",
    );
  } else {
    const raw = fs.readFileSync(file, "utf8");
    migrations.push({ file, owner, sql: ownershipSql(raw), ddl: viewDdl(raw) });
  }
}

const scanned = new Set(migrations.map(({ file }) => fs.realpathSync(file)));
for (const [directory, owner] of migrationFolders) {
  for (const file of walk(directory, (name) => name.endsWith(".sql"))) {
    const real = fs.realpathSync(file);
    if (scanned.has(real) || path.dirname(file) !== directory) continue;
    const raw = fs.readFileSync(file, "utf8");
    migrations.push({ file, owner, sql: ownershipSql(raw), ddl: viewDdl(raw) });
    scanned.add(real);
  }
}
for (const { file, owner } of moduleList.installedMigrations) {
  const raw = fs.readFileSync(file, "utf8");
  migrations.push({ file, owner, sql: ownershipSql(raw), ddl: viewDdl(raw) });
}
for (const problem of moduleList.problems) report(path.resolve(LIST_FILE), 1, problem);

const { owners, views, foreignOwner } = migrationOwnership(migrations, report);

const packageName = (workspace) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")).name;
  } catch {
    return undefined;
  }
};

// Source belongs to the nearest module; only named plumbing may open raw transactions.
const checkSource = (file, owner, { adapter, module, features, app = false }) => {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    report(file, 1, "cannot read SQL source.");
    return;
  }
  const folder = folders
    .filter(({ directory }) => file.startsWith(`${directory}${path.sep}`))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
  if (folder) {
    owner = folder.owner;
    module = true;
    adapter = false;
    if (!TEST_SOURCE.test(relative(file))) {
      for (const problem of readModelSqlProblems(source, views, { filename: file, workspaces }))
        report(file, 1, problem);
    }
  }
  const lexed = lexSource(source);
  const { sql, code } = lexed;
  if (owners.size > 0 && !folder) {
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
  const inNode = features !== undefined && file.startsWith(`${features}${path.sep}`);
  const raw = firstMatch(code, OPENS_TRANSACTION_CALL) ?? firstTransactionStart(lexed, inNode);
  if (raw !== undefined) {
    report(
      file,
      lineAt(source, raw),
      `opens a raw transaction. A transactional entry opens one unit around its graph. Only a UnitOfWork adapter or a named adapter package (${ADAPTER_FLAG}) calls withTransaction or sends begin.`,
    );
  }
  const unit =
    (module || inNode || app) && !TEST_SOURCE.test(relative(file))
      ? firstMatch(code, OPENS_UNIT)
      : undefined;
  if (unit !== undefined) {
    report(
      file,
      lineAt(source, unit),
      "a module opens a unit of work. Its writes join the entry's unit and fail with NoOpenUnit without one. Mark the app entry graph transactional instead.",
    );
  }
};

for (const workspace of workspaces) {
  const options = {
    adapter: adapters.has(packageName(workspace)),
    module: !APP_ROOT.test(`${workspace}/`),
    app: APP_ROOT.test(`${workspace}/`),
    features: path.resolve(workspace, "src", "features"),
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
    : `migrations: ${owners.size} table/view object(s) owned by ${ownerCount} module(s); no cross-module foreign keys or SQL; ${moduleList.listed} module(s) listed in ${LIST_FILE}`,
);

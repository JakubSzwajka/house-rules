import * as fs from "node:fs";
import path from "node:path";

// The module list: every module whose migrations the app runs. The runner, @house-rules/migrations, reads the same file.
export const LIST_FILE = "migrations.json";

// The runner's rules for a module name and a history table, so a list that passes here is one it can run.
const MODULE_NAME = /^[a-z][a-z0-9_]{0,47}$/u;
const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/u;
const DEFAULT_FOLDER = "migrations";
const slug = (text) => text.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const declaredFolder = (manifest) =>
  typeof manifest?.houseRules?.migrations === "string" ? manifest.houseRules.migrations : undefined;

// Node's lookup without `exports`: walk up from `from` to the first node_modules that holds the package.
const installedPackage = (from, name) => {
  for (let directory = path.resolve(from); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(directory) === directory) return undefined;
  }
};

// Reads LIST_FILE in the current folder and checks it against the workspace packages and their dependencies.
export const checkModuleList = (workspaces) => {
  const listPath = path.resolve(LIST_FILE);
  const customFolders = workspaces.flatMap((workspace) => {
    const declared = declaredFolder(readJson(path.join(workspace, "package.json")));
    return declared !== undefined &&
      path.resolve(workspace, declared) !== path.resolve(workspace, DEFAULT_FOLDER)
      ? [{ workspace, declared }]
      : [];
  });
  const requiredWorkspaces = workspaces.filter(
    (workspace) =>
      fs.existsSync(path.join(workspace, "migrations")) ||
      declaredFolder(readJson(path.join(workspace, "package.json"))) !== undefined,
  );

  // A runtime dependency that ships migrations, found from each package that depends on it.
  const requiredPackages = new Map();
  for (const owner of [".", ...workspaces]) {
    const manifest = readJson(path.join(owner, "package.json"));
    for (const [name, spec] of Object.entries(manifest?.dependencies ?? {})) {
      if (String(spec).startsWith("workspace:") || requiredPackages.has(name)) continue;
      const directory = installedPackage(owner, name);
      if (directory === undefined) continue;
      if (declaredFolder(readJson(path.join(directory, "package.json"))) !== undefined) {
        requiredPackages.set(name, owner === "." ? "the root package.json" : owner);
      }
    }
  }

  const listedWorkspaces = new Set();
  const listedPackages = new Set();
  const installedMigrations = [];
  const installedSources = [];
  const listProblems = [];
  const identities = [];
  for (const { workspace, declared } of customFolders) {
    listProblems.push(
      `workspace ${workspace} declares the migrations folder "${declared}". A workspace package keeps its migrations in ${DEFAULT_FOLDER}/: remove "houseRules.migrations" from its package.json or move the files.`,
    );
  }

  // The name and history table the runner would give this entry, held to the runner's rules.
  const checkIdentity = (label, entry, fallbackName) => {
    const name = entry.name ?? slug(fallbackName);
    const table = entry.table ?? `${name}_migrations`;
    if (!MODULE_NAME.test(name)) {
      listProblems.push(`${label}: module name ${name} is not a lowercase slug (a-z, 0-9, _).`);
    } else if (!TABLE_NAME.test(table)) {
      listProblems.push(`${label}: history table ${table} is not a lowercase SQL name.`);
    } else if (identities.some((other) => other.name === name || other.table === table)) {
      listProblems.push(`${label}: module ${name} or its history table ${table} is listed twice.`);
    }
    identities.push({ name, table });
  };
  // The runner's entry schema: each key is a string when present, and exactly one of "workspace" or "package" is a non-empty one.
  const shapeProblem = (label, entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return `${label} must be an object.`;
    }
    for (const key of ["workspace", "package"]) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") {
        return `${label} "${key}" must be a string.`;
      }
    }
    const named = ["workspace", "package"].filter((key) => entry[key] !== undefined);
    if (named.length !== 1) return `${label} must name exactly one of "workspace" or "package".`;
    if (entry[named[0]] === "") return `${label} "${named[0]}" must not be empty.`;
    if (
      (entry.name !== undefined && typeof entry.name !== "string") ||
      (entry.table !== undefined && typeof entry.table !== "string")
    ) {
      return `${label}: "name" and "table" must be strings.`;
    }
    return undefined;
  };
  // A package.json the runner can read, and a migrations folder that is a folder inside its package.
  const manifestProblem = (directory, manifest) => {
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      return "has a package.json the runner cannot read.";
    }
    const houseRules = manifest.houseRules;
    if (
      (manifest.name !== undefined && typeof manifest.name !== "string") ||
      (houseRules !== undefined &&
        (typeof houseRules !== "object" || houseRules === null || Array.isArray(houseRules))) ||
      (houseRules?.migrations !== undefined && typeof houseRules.migrations !== "string")
    ) {
      return "has a package.json the runner cannot read.";
    }
    if (typeof houseRules?.migrations === "string") {
      const inside = path.relative(directory, path.resolve(directory, houseRules.migrations));
      if (inside.length === 0 || inside.startsWith("..") || path.isAbsolute(inside)) {
        return `declares the migrations folder "${houseRules.migrations}", which is not a folder inside its package.`;
      }
    }
    return undefined;
  };
  const hasList = fs.existsSync(listPath);
  const list = hasList ? readJson(listPath) : undefined;

  if (hasList && !Array.isArray(list?.modules)) {
    listProblems.push(`${LIST_FILE} is not valid JSON of the shape { "modules": [ ... ] }.`);
  }
  for (const [index, entry] of (Array.isArray(list?.modules) ? list.modules : []).entries()) {
    const label = `entry ${index + 1}`;
    const workspace = entry?.workspace;
    const name = entry?.package;
    const shape = shapeProblem(label, entry);
    if (shape !== undefined) {
      listProblems.push(shape);
    } else if (workspace !== undefined) {
      const normalized = path
        .relative(process.cwd(), path.resolve(workspace))
        .split(path.sep)
        .join("/");
      if (normalized.length === 0 || normalized.startsWith("..") || path.isAbsolute(normalized)) {
        listProblems.push(
          `${label} names workspace "${workspace}", which is not a folder below ${path.dirname(listPath)}.`,
        );
      } else if (!workspaces.includes(normalized)) {
        listProblems.push(
          `${label} names workspace "${workspace}", which is not a workspace package.`,
        );
      } else if (!requiredWorkspaces.includes(normalized)) {
        listProblems.push(
          `${label} names workspace "${workspace}", which has no migrations/ folder.`,
        );
      } else {
        const unreadable = manifestProblem(
          normalized,
          readJson(path.join(normalized, "package.json")),
        );
        if (unreadable !== undefined) {
          listProblems.push(`${label} names workspace "${workspace}", which ${unreadable}`);
        }
        listedWorkspaces.add(normalized);
        checkIdentity(label, entry, path.basename(normalized));
      }
    } else {
      const directory = installedPackage(process.cwd(), name);
      const folder = directory && declaredFolder(readJson(path.join(directory, "package.json")));
      if (directory === undefined) {
        listProblems.push(
          `${label} names package "${name}", which is not installed where ${LIST_FILE} can resolve it. Add it to the root package.json dependencies.`,
        );
      } else if (folder === undefined) {
        listProblems.push(
          `${label} names package "${name}", whose package.json does not declare "houseRules": { "migrations": "<folder>" }.`,
        );
      } else {
        const unreadable = manifestProblem(
          directory,
          readJson(path.join(directory, "package.json")),
        );
        if (unreadable !== undefined) {
          listProblems.push(`${label} names package "${name}", which ${unreadable}`);
        }
        listedPackages.add(name);
        checkIdentity(label, entry, name.split("/").at(-1) ?? name);
        installedSources.push({ owner: name, directory: path.join(directory, "src") });
        const migrationsFolder = path.resolve(directory, folder);
        const files = fs.existsSync(migrationsFolder)
          ? fs.readdirSync(migrationsFolder).filter((file) => file.endsWith(".sql"))
          : [];
        for (const file of files) {
          installedMigrations.push({ file: path.join(migrationsFolder, file), owner: name });
        }
      }
    }
  }

  const unlisted = [
    ...requiredWorkspaces
      .filter((workspace) => !listedWorkspaces.has(workspace))
      .map((workspace) => ({
        what: `${workspace} has migrations`,
        entry: `{ "workspace": "${workspace}" }`,
      })),
    ...[...requiredPackages]
      .filter(([name]) => !listedPackages.has(name))
      .map(([name, owner]) => ({
        what: `${name}, a dependency in ${owner}, ships migrations`,
        entry: `{ "package": "${name}" }`,
      })),
  ];
  for (const { what, entry } of unlisted) {
    listProblems.push(
      hasList
        ? `${what}, but the module list does not name it. Add ${entry} to "modules".`
        : `${what}, but there is no module list. Create ${LIST_FILE} at the repository root and add ${entry} to "modules".`,
    );
  }
  return {
    problems: listProblems,
    installedMigrations,
    installedSources,
    listed: listedWorkspaces.size + listedPackages.size,
  };
};

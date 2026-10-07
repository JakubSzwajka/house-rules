import { Effect, type FileSystem, type Path, Schema } from "effect";
import { type MigrationModule, MigrationFailed } from "../types.ts";

const ModuleEntry = Schema.Struct({
  workspace: Schema.optionalKey(Schema.String),
  package: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  table: Schema.optionalKey(Schema.String),
});

const ModuleList = Schema.fromJsonString(Schema.Struct({ modules: Schema.Array(ModuleEntry) }));

const PackageManifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    houseRules: Schema.optionalKey(
      Schema.Struct({ migrations: Schema.optionalKey(Schema.String) }),
    ),
  }),
);

const MODULE_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_FOLDER = "migrations";

export const identityProblem = (
  module: Pick<MigrationModule, "name" | "table">,
  earlier: ReadonlyArray<Pick<MigrationModule, "name" | "table">>,
) => {
  if (!MODULE_NAME.test(module.name)) {
    return `module name ${module.name} is not a lowercase slug (a-z, 0-9, _).`;
  }
  if (!TABLE_NAME.test(module.table)) {
    return `history table ${module.table} is not a lowercase SQL name.`;
  }
  if (earlier.some((other) => other.name === module.name || other.table === module.table)) {
    return `module ${module.name} or its history table ${module.table} is listed twice.`;
  }
  return undefined;
};

export const checkIdentities = Effect.fnUntraced(function* checkIdentities(
  modules: ReadonlyArray<MigrationModule>,
) {
  for (const [index, module] of modules.entries()) {
    const problem = identityProblem(module, modules.slice(0, index));
    if (problem !== undefined) {
      return yield* new MigrationFailed({ message: `Module ${index + 1}: ${problem}` });
    }
  }
});

const slug = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_");

const failed = (message: string) => (cause: unknown) => new MigrationFailed({ message, cause });

const readManifest = Effect.fnUntraced(function* readManifest(
  fs: FileSystem.FileSystem,
  file: string,
) {
  const text = yield* fs.readFileString(file).pipe(Effect.mapError(failed(`Cannot read ${file}.`)));
  return yield* Schema.decodeEffect(PackageManifest)(text).pipe(
    Effect.mapError(failed(`${file} is not a valid package.json.`)),
  );
});

const findInstalledPackage = Effect.fnUntraced(function* findInstalledPackage(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  from: string,
  name: string,
) {
  // Node's lookup without `exports`: a package that exports only "." still has its folder on disk.
  let directory = from;
  while (true) {
    const candidate = path.join(directory, "node_modules", name);
    const found = yield* fs
      .exists(path.join(candidate, "package.json"))
      .pipe(Effect.mapError(failed(`Cannot look for ${name} in ${directory}.`)));
    if (found) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) {
      return yield* new MigrationFailed({
        message: `Package ${name} is not installed where ${from} can resolve it. Add it to the dependencies of the package next to the module list.`,
      });
    }
    directory = parent;
  }
});

const insideFolder = (path: Path.Path, root: string, folder: string) => {
  const target = path.resolve(root, folder);
  const inside = path.relative(root, target);
  return inside.length > 0 && !inside.startsWith("..") && !path.isAbsolute(inside)
    ? target
    : undefined;
};

export const readModuleList = Effect.fnUntraced(function* readModuleList(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  listFile: string,
) {
  const root = path.dirname(path.resolve(listFile));
  const text = yield* fs
    .readFileString(listFile)
    .pipe(Effect.mapError(failed(`Cannot read the module list ${listFile}.`)));
  const list = yield* Schema.decodeEffect(ModuleList)(text).pipe(
    Effect.mapError(
      failed(
        `The module list ${listFile} is not { "modules": [{ "workspace" | "package", "name"?, "table"? }] }.`,
      ),
    ),
  );
  const modules: Array<MigrationModule> = [];
  for (const [index, entry] of list.modules.entries()) {
    const label = `Module list entry ${index + 1}`;
    if ((entry.workspace === undefined) === (entry.package === undefined)) {
      return yield* new MigrationFailed({
        message: `${label} must name exactly one of "workspace" or "package".`,
      });
    }
    let packageDirectory: string;
    let fallbackName: string;
    if (entry.workspace !== undefined) {
      const resolved = insideFolder(path, root, entry.workspace);
      if (resolved === undefined) {
        return yield* new MigrationFailed({
          message: `${label}: workspace ${entry.workspace} is not a folder below ${root}.`,
        });
      }
      packageDirectory = resolved;
      fallbackName = path.basename(resolved);
    } else {
      const name = entry.package ?? "";
      packageDirectory = yield* findInstalledPackage(fs, path, root, name);
      fallbackName = name.split("/").at(-1) ?? name;
    }
    const manifest = yield* readManifest(fs, path.join(packageDirectory, "package.json"));
    const declared = manifest.houseRules?.migrations;
    if (entry.package !== undefined && declared === undefined) {
      return yield* new MigrationFailed({
        message: `${label}: package ${entry.package} does not declare "houseRules": { "migrations": "<folder>" } in its package.json.`,
      });
    }
    // A workspace package always keeps its migrations in migrations/, the one folder house-rules-migrations checks.
    if (entry.workspace !== undefined && declared !== undefined) {
      const standard = path.resolve(packageDirectory, DEFAULT_FOLDER);
      if (path.resolve(packageDirectory, declared) !== standard) {
        return yield* new MigrationFailed({
          message: `${label}: workspace ${entry.workspace} declares the migrations folder ${declared}. A workspace package keeps its migrations in ${DEFAULT_FOLDER}/; remove "houseRules.migrations" from its package.json or move the files.`,
        });
      }
    }
    const directory = insideFolder(path, packageDirectory, declared ?? DEFAULT_FOLDER);
    if (directory === undefined) {
      return yield* new MigrationFailed({
        message: `${label}: the migrations folder ${declared} is not a folder inside its package.`,
      });
    }
    const name = entry.name ?? slug(fallbackName);
    const table = entry.table ?? `${name}_migrations`;
    const problem = identityProblem({ name, table }, modules);
    if (problem !== undefined) {
      return yield* new MigrationFailed({ message: `${label}: ${problem}` });
    }
    modules.push({ name, directory, table });
  }
  return modules;
});

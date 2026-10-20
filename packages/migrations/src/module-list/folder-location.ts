import { Effect, type FileSystem, type Path } from "effect";
import { MigrationFailed } from "../migration/migration.ts";

export const insideFolder = (path: Path.Path, root: string, folder: string) => {
  const target = path.resolve(root, folder);
  const inside = path.relative(root, target);
  return inside.length > 0 && !inside.startsWith("..") && !path.isAbsolute(inside)
    ? target
    : undefined;
};
const failed = (message: string) => (cause: unknown) => new MigrationFailed({ message, cause });

export const ownedMigrations = Effect.fnUntraced(function* ownedMigrations(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  moduleDirectory: string,
  directory: string,
  label: string,
) {
  const realModule = yield* fs
    .realPath(moduleDirectory)
    .pipe(Effect.mapError(failed(`Cannot resolve ${moduleDirectory}.`)));
  const symlink = yield* fs
    .readLink(directory)
    .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
  if (symlink)
    return yield* new MigrationFailed({
      message: `${label}: migrations/ must be its own directory, not a symlink.`,
    });
  const realMigrations = yield* fs
    .realPath(directory)
    .pipe(Effect.mapError(failed(`Cannot resolve ${directory}.`)));
  if (insideFolder(path, realModule, path.relative(realModule, realMigrations)) === undefined)
    return yield* new MigrationFailed({
      message: `${label}: migrations/ resolves outside its own module.`,
    });
  for (const target of [moduleDirectory, directory]) {
    const info = yield* fs.stat(target).pipe(Effect.mapError(failed(`Cannot read ${target}.`)));
    if (info.type !== "Directory")
      return yield* new MigrationFailed({ message: `${label}: ${target} is not a directory.` });
  }
  const entries = yield* fs
    .readDirectory(directory)
    .pipe(Effect.mapError(failed(`Cannot read ${directory}.`)));
  for (const entry of entries.filter((name) => name.endsWith(".sql"))) {
    const linked = yield* fs
      .readLink(path.join(directory, entry))
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (linked)
      return yield* new MigrationFailed({
        message: `${label}: migration file ${entry} must not be a symlink.`,
      });
  }
});

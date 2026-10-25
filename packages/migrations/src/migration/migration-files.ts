import { type Crypto, Effect, type FileSystem, type Path } from "effect";
import { Hex } from "effect/encoding";
import { MigrationFailed } from "./migration.ts";

const FILE_NAME = /^(\d+)_([a-z0-9_]+)\.sql$/;
const migrationChunks = (text: string) =>
  // Mirror packages/rules/src/migration-chunks.mjs.
  text
    .split(/^--> statement-breakpoint[ \t]*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

export type MigrationFile = Readonly<{
  id: number;
  name: string;
  sha256: string;
  statements: ReadonlyArray<string>;
}>;

export const readMigrationFiles = Effect.fnUntraced(function* readMigrationFiles(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  crypto: Crypto.Crypto,
  module: string,
  directory: string,
) {
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.mapError(
      (cause) =>
        new MigrationFailed({
          message: `Module ${module}: cannot read the migrations folder ${directory}.`,
          cause,
        }),
    ),
  );
  const files: Array<MigrationFile> = [];
  for (const entry of entries.filter((name) => name.endsWith(".sql"))) {
    const linked = yield* fs
      .readLink(path.join(directory, entry))
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (linked)
      return yield* new MigrationFailed({
        message: `Module ${module}: migration file ${entry} must not be a symlink.`,
      });
    const match = FILE_NAME.exec(entry);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return yield* new MigrationFailed({
        message: `Module ${module}: migration file ${entry} is not named <id>_<name>.sql.`,
      });
    }
    const bytes = yield* fs.readFile(path.join(directory, entry)).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationFailed({
            message: `Module ${module}: cannot read migration ${entry}.`,
            cause,
          }),
      ),
    );
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: (cause) =>
        new MigrationFailed({
          message: `Module ${module}: migration ${entry} is not valid UTF-8.`,
          cause,
        }),
    });
    const digest = yield* crypto.digest("SHA-256", bytes).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationFailed({
            message: `Module ${module}: cannot hash migration ${entry}.`,
            cause,
          }),
      ),
    );
    files.push({
      id: Number(match[1]),
      name: match[2],
      sha256: Hex.encode(digest),
      statements: migrationChunks(text),
    });
  }
  files.sort((left, right) => left.id - right.id);
  const ids = new Set(files.map((file) => file.id));
  if (ids.size !== files.length) {
    return yield* new MigrationFailed({
      message: `Module ${module}: two migration files share one id.`,
    });
  }
  return files;
});

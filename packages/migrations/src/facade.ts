import { Crypto, Effect, FileSystem, Path } from "effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { checkApplied, lockHistory, toMigrationRecord } from "./history/history.ts";
import { readMigrationFiles } from "./migration/migration-files.ts";
import { checkIdentities, readModuleList } from "./module-list/module-list.ts";
import {
  type AppliedMigration,
  MigrationFailed,
  type MigrationModule,
  type MigrationReport,
  type ModuleReport,
} from "./migration/migration.ts";

const readModules = Effect.fnUntraced(function* readModules(listFile: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* readModuleList(fs, path, listFile);
});

const describeDefect = (defect: unknown) =>
  typeof defect === "object" && defect !== null && "message" in defect
    ? String(defect.message)
    : "it stopped with a defect";

const run = Effect.fnUntraced(function* run(modules: ReadonlyArray<MigrationModule>) {
  // Before any file or SQL: two modules on one name or history table would skip a migration without a sign.
  yield* checkIdentities(modules);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient;
  const loaded = yield* Effect.forEach(modules, (module) =>
    readMigrationFiles(fs, path, crypto, module.name, module.directory).pipe(
      Effect.map((files) => ({ module, files })),
    ),
  );
  // One transaction for every module: a digest mismatch anywhere leaves nothing applied or backfilled.
  const reports = yield* sql
    .withTransaction(
      Effect.gen(function* checkThenApply() {
        // Sorted, so two runs over overlapping module lists take the locks in one order.
        for (const table of modules.map((module) => module.table).sort()) {
          yield* lockHistory(sql, table);
        }
        const checked = yield* Effect.forEach(loaded, ({ module, files }) =>
          checkApplied(sql, module.name, module.table, files),
        );
        const done: Array<ModuleReport> = [];
        for (const [index, { module, files }] of loaded.entries()) {
          const applied = yield* Migrator.make({})({
            loader: Migrator.fromRecord(toMigrationRecord(sql, module.table, files)),
            table: module.table,
          }).pipe(
            Effect.catchDefect((defect) =>
              Effect.fail(
                new MigrationFailed({
                  message: `Module ${module.name}: ${describeDefect(defect)}.`,
                  cause: defect,
                }),
              ),
            ),
          );
          done.push({
            module: module.name,
            table: module.table,
            verified: checked[index]?.verified ?? [],
            backfilled: checked[index]?.backfilled ?? [],
            applied: applied.map(([id, name]) => ({ id, name })),
          });
        }
        return done;
      }),
    )
    .pipe(
      Effect.catchTag(["SqlError", "MigrationError"], (cause) =>
        Effect.fail(new MigrationFailed({ message: `Migrations failed: ${cause.message}`, cause })),
      ),
    );
  return reports satisfies MigrationReport;
});

const names = (migrations: ReadonlyArray<AppliedMigration>) =>
  migrations.length === 0
    ? "none"
    : migrations.map((migration) => `${migration.id}_${migration.name}`).join(", ");

const formatReport = (report: MigrationReport): ReadonlyArray<string> =>
  report.map(
    (module) =>
      `Migrations ${module.module} (${module.table}): digest verified ${names(module.verified)}; digest backfilled ${names(module.backfilled)}; applied ${names(module.applied)}.`,
  );

const runList = (listFile: string) => readModules(listFile).pipe(Effect.flatMap(run));

export const Migrations = {
  readModuleList: readModules,
  run,
  runList,
  formatReport,
  script: (listFile: string) =>
    runList(listFile).pipe(
      Effect.tap((report) =>
        Effect.forEach(formatReport(report), (line) => Effect.logInfo(line), { discard: true }),
      ),
    ),
} as const;

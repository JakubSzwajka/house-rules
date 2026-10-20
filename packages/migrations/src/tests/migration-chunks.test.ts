import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Migrations, MigrationsTesting } from "../index.ts";
import { scratchApp } from "./scratch-app.ts";

const Cases = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      label: Schema.String,
      sql: Schema.String,
      chunks: Schema.Array(Schema.String),
      verify: Schema.String,
    }),
  ),
);
const database = Layer.merge(
  NodeServices.layer,
  MigrationsTesting.database({
    label: "chunks",
    client: (url) => PgClient.layer({ url, maxConnections: 1 }),
  }),
);
const options = { excludeTestServices: true, timeout: "30 seconds" } as const;

layer(database, options)("canonical migration chunks", (it) => {
  it.effect(
    "runs the shared checker fixture with exact runner chunks, rolling back each case",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cases = yield* Schema.decodeEffect(Cases)(
          yield* fs.readFileString(
            path.resolve(
              import.meta.dirname,
              "../../../rules/tests/fixtures/migrations/chunk-parity.json",
            ),
          ),
        );
        const source = yield* fs.readFileString(
          path.resolve(import.meta.dirname, "../migration/migration-files.ts"),
        );
        const counterpart = yield* fs.readFileString(
          path.resolve(import.meta.dirname, "../../../rules/src/migration-chunks.mjs"),
        );
        const runner = yield* fs.readFileString(path.resolve(import.meta.dirname, "../facade.ts"));
        expect(runner).toMatch(
          /function\* checkThenApply\(\) \{\s*yield\* sql`SET LOCAL standard_conforming_strings = on`;/u,
        );
        // Pin both private copies as well as executing the actual runner below.
        const algorithm = (text: string) =>
          text.slice(
            text.indexOf("  text\n"),
            text.indexOf("statement.length > 0);") + "statement.length > 0);".length,
          );
        expect(algorithm(source)).not.toBe("");
        expect(algorithm(source)).toBe(algorithm(counterpart));
        for (const item of cases) {
          const app = yield* scratchApp({
            "migrations.json": '{"modules":[{"workspace":"packages/bill"}]}',
            "packages/bill/package.json": '{"name":"@test/bill"}',
            "packages/bill/migrations/0001_bill.sql": item.sql,
          });
          const sql = yield* SqlClient;
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`create table orders(id text, hidden_value text)`;
                yield* sql`insert into orders values ('fixed_marker', 'fixed_marker')`;
                yield* sql`create view orders_read as select id from orders`;
                yield* Migrations.runList(app.list);
                expect(yield* sql.unsafe<{ ok: boolean }>(item.verify), item.label).toEqual([
                  { ok: true },
                ]);
                return yield* Effect.fail("fixture rollback");
              }),
            )
            .pipe(
              Effect.catchIf(
                (error) => error === "fixture rollback",
                () => Effect.void,
              ),
            );
          expect(yield* sql`select to_regclass('bill') is null as gone`).toEqual([{ gone: true }]);
        }
      }),
  );
  it.effect("re-pins standard strings before every chunk and across files", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const app = yield* scratchApp({
        "migrations.json": '{"modules":[{"workspace":"packages/repin"}]}',
        "packages/repin/package.json": '{"name":"@test/repin"}',
        "packages/repin/migrations/0001_repin.sql": [
          "do $$ begin perform set_config('standard_conforming_strings', 'off', true); end $$;",
          "create table repin as select current_setting('standard_conforming_strings') as value;",
          "do $$ begin perform set_config('standard_conforming_strings', 'off', true); end $$;",
          "insert into repin select current_setting('standard_conforming_strings');",
          "do $$ begin perform set_config('standard_conforming_strings', 'off', true); end $$;",
        ].join("\n--> statement-breakpoint\n"),
        "packages/repin/migrations/0002_repin.sql":
          "insert into repin select current_setting('standard_conforming_strings');",
      });
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* Migrations.runList(app.list);
            expect(yield* sql`select value from repin`).toEqual([
              { value: "on" },
              { value: "on" },
              { value: "on" },
            ]);
            return yield* Effect.fail("repin rollback");
          }),
        )
        .pipe(
          Effect.catchIf(
            (error) => error === "repin rollback",
            () => Effect.void,
          ),
        );
      expect(yield* sql`select to_regclass('repin') is null as gone`).toEqual([{ gone: true }]);
    }),
  );
  it.effect("pins standard strings on before migration SQL when the session default is off", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* sql`set standard_conforming_strings = off`;
      expect(yield* sql`show standard_conforming_strings`).toEqual([
        { standard_conforming_strings: "off" },
      ]);
      const app = yield* scratchApp({
        "migrations.json": '{"modules":[{"workspace":"packages/mode"}]}',
        "packages/mode/package.json": '{"name":"@test/mode"}',
        "packages/mode/migrations/0001_mode.sql":
          "create table mode as select current_setting('standard_conforming_strings') as value;",
      });
      yield* Migrations.runList(app.list);
      expect(yield* sql`select value from mode`).toEqual([{ value: "on" }]);
      expect(yield* sql`show standard_conforming_strings`).toEqual([
        { standard_conforming_strings: "off" },
      ]);
      yield* sql`set standard_conforming_strings = on`;
    }),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Migrations, MigrationsTesting } from "../index.ts";
import { scratchApp } from "./scratch-app.ts";

const workspace = "packages/orders";
const migrationSql =
  "create table folder_order(id integer);\n--> statement-breakpoint\ncreate view folder_order_read as select id from folder_order;";
const migration = { [`${workspace}/migrations/001_orders.sql`]: migrationSql };
layer(NodeServices.layer)("package manifest validation", (it) => {
  it.effect("rejects a package's broken manifest", () =>
    Effect.gen(function* () {
      const app = yield* scratchApp({
        ...migration,
        [`${workspace}/package.json`]: "{broken",
        "migrations.json": JSON.stringify({ modules: [{ workspace }] }),
      });
      const error = yield* Migrations.readModuleList(app.list).pipe(Effect.flip);
      expect(error.message).toContain("not a valid package.json");
    }),
  );
});
layer(
  Layer.merge(
    NodeServices.layer,
    MigrationsTesting.database({
      label: "folder_module",
      client: (url) => PgClient.layer({ url }),
    }),
  ),
  { excludeTestServices: true, timeout: "30 seconds" },
)("package module on Postgres", (it) => {
  it.effect("runs and verifies a package module", () =>
    Effect.gen(function* () {
      const app = yield* scratchApp({
        ...migration,
        [`${workspace}/package.json`]: "{}",
        "migrations.json": JSON.stringify({ modules: [{ workspace }] }),
      });
      const first = yield* Migrations.runList(app.list);
      expect(first[0]?.module).toBe("orders");
      expect(first[0]?.applied).toHaveLength(1);
      const rows = yield* SqlClient.use((sql) => sql`select * from folder_order_read`);
      expect(rows).toEqual([]);
      const again = yield* Migrations.runList(app.list);
      expect(again[0]?.verified).toHaveLength(1);
      expect(again[0]?.applied).toEqual([]);
    }),
  );
});

layer(
  Layer.merge(
    NodeServices.layer,
    MigrationsTesting.database({
      label: "folder_adopt",
      client: (url) => PgClient.layer({ url }),
    }),
  ),
  { excludeTestServices: true, timeout: "30 seconds" },
)("package adoption with workspace and installed package", (it) => {
  it.effect(
    "adopts package history once and runs workspace and installed locations atomically",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const app = yield* scratchApp({
          "packages/orders/package.json": "{}",
          "packages/orders/migrations/001_orders.sql":
            "create table mixed_order(id integer);\n--> statement-breakpoint\ncreate view mixed_order_read as select id from mixed_order;",
          "packages/trips/package.json": "{}",
          "packages/trips/migrations/001_trips.sql": "create table mixed_trip(id integer);",
          "node_modules/@vendor/audit/package.json": '{"houseRules":{"migrations":"migrations"}}',
          "node_modules/@vendor/audit/migrations/001_audit.sql":
            "create table mixed_audit(id integer);",
          "migrations.json": JSON.stringify({
            modules: [
              { workspace: "packages/orders", adopt: { from: "old_history", ids: [1] } },
              { workspace: "packages/trips" },
              { package: "@vendor/audit" },
            ],
          }),
        });
        yield* Migrations.run([
          {
            name: "old",
            table: "old_history",
            directory: path.join(path.dirname(app.list), "packages/orders/migrations"),
          },
        ]);
        const old = yield* SqlClient.use(
          (sql) => sql`select * from old_history order by migration_id`,
        );
        const report = yield* Migrations.runList(app.list);
        expect(report).toEqual([
          {
            module: "orders",
            table: "orders_migrations",
            adoption: { from: "old_history", adopted: [{ id: 1, name: "orders" }], rehashed: [] },
            verified: [{ id: 1, name: "orders" }],
            backfilled: [],
            applied: [],
          },
          {
            module: "trips",
            table: "trips_migrations",
            verified: [],
            backfilled: [],
            applied: [{ id: 1, name: "trips" }],
          },
          {
            module: "audit",
            table: "audit_migrations",
            verified: [],
            backfilled: [],
            applied: [{ id: 1, name: "audit" }],
          },
        ]);
        expect(yield* SqlClient.use((sql) => sql`select * from mixed_order_read`)).toEqual([]);
        expect(yield* SqlClient.use((sql) => sql`select * from mixed_trip`)).toEqual([]);
        expect(yield* SqlClient.use((sql) => sql`select * from mixed_audit`)).toEqual([]);
        expect(
          yield* SqlClient.use((sql) => sql`select * from old_history order by migration_id`),
        ).toEqual(old);
        const again = yield* Migrations.runList(app.list);
        expect(again.map(({ applied, verified }) => ({ applied, verified }))).toEqual([
          { applied: [], verified: [{ id: 1, name: "orders" }] },
          { applied: [], verified: [{ id: 1, name: "trips" }] },
          { applied: [], verified: [{ id: 1, name: "audit" }] },
        ]);
        expect(again[0]?.adoption?.adopted).toEqual([]);
      }),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { AuditReadFailed, CallAudit } from "../../index.ts";

const migrationsDirectory = new URL("../../../migrations", import.meta.url).pathname;

const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    { name: "call_audit", directory: migrationsDirectory, table: "call_audit_migrations" },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "audit_read",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

const clearRows = SqlClient.use((sql) => sql`delete from call_audit`);

const insert = (capability: string, viewerId: string | null, outcome: string, ms: number) =>
  SqlClient.use(
    (sql) => sql`insert into call_audit (capability, permission, viewer_id, outcome, ms)
      values (${capability}, 'trips:read', ${viewerId}, ${outcome}, ${ms})`,
  );

layer(migratedDatabase, { excludeTestServices: true, timeout: "30 seconds" })(
  "CallAudit.readRows",
  (it) => {
    it.effect("an empty table gives []", () =>
      Effect.gen(function* emptyTable() {
        yield* clearRows;
        expect(yield* CallAudit.readRows()).toEqual([]);
      }),
    );

    it.effect("returns decoded rows, newest first", () =>
      Effect.gen(function* decodedAndOrdered() {
        yield* clearRows;
        yield* insert("first", "user_ana", "success", 3);
        yield* insert("second", null, "Forbidden", 7);
        const found = yield* CallAudit.readRows();
        expect(found.map((row) => row.capability)).toEqual(["second", "first"]);
        expect(found[0]).toMatchObject({
          capability: "second",
          permission: "trips:read",
          viewerId: null,
          outcome: "Forbidden",
          ms: 7,
        });
        expect(found[1]?.viewerId).toBe("user_ana");
        expect(found[0]?.recordedAt).toBeInstanceOf(Date);
        expect(typeof found[0]?.ms).toBe("number");
        expect(Object.keys(found[0] ?? {}).sort()).toEqual([
          "capability",
          "channel",
          "kind",
          "ms",
          "outcome",
          "permission",
          "recordedAt",
          "requestId",
          "targetId",
          "viewerId",
        ]);
      }),
    );

    it.effect("limit keeps the newest rows", () =>
      Effect.gen(function* limited() {
        yield* clearRows;
        yield* insert("a", null, "success", 1);
        yield* insert("b", null, "success", 1);
        yield* insert("c", null, "success", 1);
        const found = yield* CallAudit.readRows({ limit: 2 });
        expect(found.map((row) => row.capability)).toEqual(["c", "b"]);
      }),
    );

    it.effect("the limit defaults to 100 and is capped at 1000", () =>
      Effect.gen(function* limitBounds() {
        yield* clearRows;
        yield* SqlClient.use(
          (sql) => sql`insert into call_audit (capability, permission, outcome, ms)
            select 'bulk', 'trips:read', 'success', 1 from generate_series(1, 1100)`,
        );
        expect(yield* CallAudit.readRows()).toHaveLength(100);
        expect(yield* CallAudit.readRows({ limit: 5000 })).toHaveLength(1000);
        expect(yield* CallAudit.readRows({ limit: 0 })).toHaveLength(1);
      }),
    );

    it.effect("viewerId keeps one caller's rows, and the limit applies after the filter", () =>
      Effect.gen(function* filtered() {
        yield* clearRows;
        yield* insert("a", "user_ana", "success", 1);
        yield* insert("b", "user_bo", "success", 1);
        yield* insert("c", "user_ana", "success", 1);
        yield* insert("d", "user_bo", "success", 1);
        const ana = yield* CallAudit.readRows({ viewerId: "user_ana" });
        expect(ana.map((row) => row.capability)).toEqual(["c", "a"]);
        const bo = yield* CallAudit.readRows({ viewerId: "user_bo", limit: 1 });
        expect(bo.map((row) => row.capability)).toEqual(["d"]);
        expect(yield* CallAudit.readRows({ viewerId: "nobody" })).toEqual([]);
      }),
    );

    it.effect("orders by recordedAt first, then id, even when a higher id is older", () =>
      Effect.gen(function* timestampFirst() {
        yield* clearRows;
        yield* SqlClient.use(
          (sql) => sql`insert into call_audit (capability, permission, outcome, ms, recorded_at)
            values ('newer_low_id', 'trips:read', 'success', 1, '2026-10-07T12:00:00Z'),
                   ('older_high_id', 'trips:read', 'success', 1, '2026-10-06T12:00:00Z'),
                   ('tie_first', 'trips:read', 'success', 1, '2026-10-05T12:00:00Z'),
                   ('tie_second', 'trips:read', 'success', 1, '2026-10-05T12:00:00Z')`,
        );
        const newest = yield* CallAudit.readRows({ limit: 1 });
        expect(newest.map((row) => row.capability)).toEqual(["newer_low_id"]);
        const all = yield* CallAudit.readRows();
        expect(all.map((row) => row.capability)).toEqual([
          "newer_low_id",
          "older_high_id",
          "tie_second",
          "tie_first",
        ]);
      }),
    );

    it.effect("a row the Schema rejects is a typed AuditReadFailed, not a result", () =>
      Effect.gen(function* invalidRow() {
        yield* clearRows;
        // Make `ms` text so a row holds a value the Schema (a finite number) rejects.
        yield* SqlClient.use((sql) => sql`alter table call_audit alter column ms type text`);
        const failure = yield* insert("poisoned", null, "success", 1).pipe(
          Effect.andThen(CallAudit.readRows()),
          Effect.flip,
          Effect.ensuring(
            clearRows.pipe(
              Effect.andThen(
                SqlClient.use(
                  (sql) =>
                    sql`alter table call_audit alter column ms type integer using ms::integer`,
                ),
              ),
              Effect.ignoreCause,
            ),
          ),
        );
        expect(failure).toBeInstanceOf(AuditReadFailed);
        expect(failure._tag).toBe("AuditReadFailed");
        expect(failure.message).toContain("ms");
      }),
    );

    it.effect("a SQL failure is a typed AuditReadFailed", () =>
      Effect.gen(function* brokenTable() {
        yield* SqlClient.use((sql) => sql`alter table call_audit rename to call_audit_away`);
        const failure = yield* CallAudit.readRows().pipe(
          Effect.flip,
          Effect.ensuring(
            SqlClient.use((sql) => sql`alter table call_audit_away rename to call_audit`).pipe(
              Effect.ignoreCause,
            ),
          ),
        );
        expect(failure).toBeInstanceOf(AuditReadFailed);
        expect(failure._tag).toBe("AuditReadFailed");
      }),
    );
  },
);

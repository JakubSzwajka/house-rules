import { expect, layer } from "@effect/vitest";
import { Effect, Exit, Fiber, Schedule } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { AuditStore, CallAudit, postgresAuditStore } from "../../index.ts";
import { allRows, asViewer, onWeb, renameTrip, seed, who } from "../../tests/audit-fixtures.ts";
import { migratedDatabase } from "./stores.ts";

const lockKey = "hashtext('@house-rules/call-audit/retention')";

const advisoryLocksHeld = SqlClient.use(
  (sql) => sql`
    select count(*)::int as held from pg_locks
    where locktype = 'advisory' and granted
      and database = (select oid from pg_database where datname = current_database())
      and objsubid = 1
      and objid::bigint = (${sql.unsafe(lockKey)}::bigint & 4294967295)`,
).pipe(Effect.map((rows) => Number(rows[0]?.held)));

const deleteBlockedInTrigger = SqlClient.use(
  (sql) => sql`
    select count(*)::int as sleeping from pg_stat_activity
    where datname = current_database() and wait_event = 'PgSleep'`,
).pipe(Effect.map((rows) => Number(rows[0]?.sleeping)));

const slowDeleteFunction = `
  create or replace function slow_delete() returns trigger language plpgsql as $$
  begin perform pg_sleep(30); return old; end $$`;

const slowDeleteTrigger =
  "create trigger slow_delete before delete on call_audit for each row execute function slow_delete()";

const noCutoffs = { read: null, write: null, failure: null };

const audit = CallAudit.layerPostgres({ who, policy: CallAudit.presets.minimal });

layer(migratedDatabase("audit_lock"), { excludeTestServices: true, timeout: "30 seconds" })(
  "call_audit retention on Postgres",
  (it) => {
    it.effect("a run skips while another session holds the retention lock", () =>
      Effect.gen(function* lockHeldElsewhere() {
        yield* SqlClient.use((sql) => sql`delete from call_audit`);
        yield* seed({ capability: "expired" }, 100).pipe(Effect.provide(postgresAuditStore));
        const sql = yield* SqlClient;
        const blocked = yield* Effect.scoped(
          Effect.gen(function* holdLock() {
            const other = yield* sql.reserve;
            yield* other.execute(`select pg_advisory_lock(${lockKey})`, [], undefined);
            const run = yield* CallAudit.runRetention(CallAudit.presets.minimal).pipe(
              Effect.provide(postgresAuditStore),
            );
            yield* other.execute(`select pg_advisory_unlock(${lockKey})`, [], undefined);
            return run;
          }),
        );
        expect(blocked).toEqual({ ran: false, deleted: { read: 0, write: 0, failure: 0 } });
        const after = yield* CallAudit.runRetention(CallAudit.presets.minimal).pipe(
          Effect.provide(postgresAuditStore),
        );
        expect(after).toEqual({ ran: true, deleted: { read: 0, write: 1, failure: 0 } });
      }),
    );

    it.effect("the lock is released when a delete fails in SQL", () =>
      Effect.gen(function* lockAfterSqlFailure() {
        const failed = yield* AuditStore.use((store) =>
          store.deleteExpired({ ...noCutoffs, write: "not a timestamp" as unknown as Date }, 10),
        ).pipe(Effect.exit);
        expect(Exit.isFailure(failed)).toBe(true);
        expect(yield* advisoryLocksHeld).toBe(0);
        const later = yield* CallAudit.runRetention(CallAudit.presets.minimal);
        expect(later.ran).toBe(true);
        expect(yield* advisoryLocksHeld).toBe(0);
      }).pipe(Effect.provide(postgresAuditStore)),
    );

    it.effect("the lock is released when a running retention fiber is interrupted", () =>
      Effect.gen(function* lockAfterInterrupt() {
        yield* SqlClient.use((sql) => sql`delete from call_audit`);
        yield* seed({ capability: "pinned" }, 100);
        yield* SqlClient.use((sql) => sql.unsafe(slowDeleteFunction));
        yield* SqlClient.use((sql) => sql.unsafe(slowDeleteTrigger));
        const fiber = yield* CallAudit.runRetention(CallAudit.presets.minimal).pipe(
          Effect.forkChild,
        );
        yield* deleteBlockedInTrigger.pipe(
          Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (n) => n >= 1 }),
        );
        expect(yield* advisoryLocksHeld).toBe(1);
        yield* Fiber.interrupt(fiber);
        expect(yield* advisoryLocksHeld).toBe(0);
        yield* SqlClient.use((sql) => sql.unsafe("drop trigger slow_delete on call_audit"));
        const later = yield* CallAudit.runRetention(CallAudit.presets.minimal);
        expect(later).toEqual({ ran: true, deleted: { read: 0, write: 1, failure: 0 } });
      }).pipe(Effect.provide(postgresAuditStore)),
    );

    it.effect("layerPostgres mounts capture and erase in one layer", () =>
      Effect.gen(function* oneLayer() {
        yield* SqlClient.use((sql) => sql`delete from call_audit`);
        yield* onWeb(renameTrip.handler({ tripId: "t-1", title: "x" })).pipe(asViewer("user_ana"));
        expect(yield* allRows).toMatchObject([
          { capability: "rename_trip", viewerId: "user_ana", targetId: "t-1", channel: "web" },
        ]);
        expect(yield* CallAudit.erase("user_ana")).toBe(1);
        expect(yield* allRows).toEqual([]);
      }).pipe(Effect.provide(audit)),
    );
  },
);

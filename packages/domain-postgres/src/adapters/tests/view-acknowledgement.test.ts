import { type ViewKit, type ViewSnapshot, type ViewStore } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { SqlError } from "effect/sql/SqlError";
import { PgForTests, testSchema } from "../from-env.ts";
import { AcknowledgeViewDelivery } from "../host.ts";
import { TallyApi, TallyId } from "./tally.ts";
import {
  onPostgres,
  type Record,
  recordTransactions,
  until,
  worldIn,
} from "./view-delivery-fixture.ts";

describe.skipIf(!onPostgres)("view delivery acknowledgements", () => {
  it.live(
    "isolates acknowledgement from apply, nested receives, child fibers and observation",
    () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const stores = new Map<string, ViewStore>();
        const sql = yield* Pg.PgClient;
        yield* recordTransactions(schema);
        const seen: Array<{ boundary: string; acknowledge: Effect.Effect<void, SqlError> }> = [];
        const replaying = new Map<string, number>();
        const observed = yield* Deferred.make<void>();
        const inspect = (kit: ViewKit): ViewKit => ({
          ...kit,
          history: (target, source, key, rows) =>
            Effect.gen(function* () {
              const history = yield* kit.history(target, source, key, rows);
              replaying.set(
                key,
                history.reduce((count, row) => count + row.deliveries.length, 0),
              );
              return history;
            }),
          apply: (key, snapshot, deliveries) =>
            Effect.gen(function* () {
              const remaining = replaying.get(key) ?? 0;
              const phase =
                key === "nested" ? "nested-receive" : remaining > 0 ? "lazy-fill" : "live-receive";
              replaying.set(key, Math.max(0, remaining - deliveries.length));
              seen.push({
                boundary: `${phase}:apply`,
                acknowledge: yield* AcknowledgeViewDelivery,
              });
              seen.push({
                boundary: `${phase}:child-fiber`,
                acknowledge: yield* Effect.forkChild(AcknowledgeViewDelivery).pipe(
                  Effect.flatMap(Fiber.join),
                ),
              });
              if (key !== "nested") {
                const store = stores.get(kit.name);
                if (!store) return yield* Effect.die("view store missing");
                yield* store.receive("nested", []);
              }
              return yield* kit.apply(key, snapshot, deliveries);
            }),
          observe: (key, deliveries) => (effect) =>
            Effect.gen(function* () {
              const phase = key === "nested" ? "nested-receive" : "live-receive";
              seen.push({
                boundary: `${phase}:observe-before`,
                acknowledge: yield* AcknowledgeViewDelivery,
              });
              const result = yield* effect;
              seen.push({
                boundary: `${phase}:observe-after`,
                acknowledge: yield* AcknowledgeViewDelivery,
              });
              if (key !== "nested") yield* Deferred.succeed(observed, undefined);
              return result;
            }).pipe(kit.observe(key, deliveries)),
        });
        yield* Effect.gen(function* () {
          const api = yield* TallyApi.clientInProcess;
          const id = TallyId.make("isolated");
          yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
          const receipt = yield* api.AddToTally(id, { amount: 3 });
          yield* until(sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`, (rows) =>
            rows.some((row) => row.kind === "ack"),
          );
          yield* Deferred.await(observed).pipe(Effect.timeout("5 seconds"));
          yield* api.TallyTotals.get(id, { atLeast: receipt });
          expect([...new Set(seen.map(({ boundary }) => boundary))].sort()).toEqual([
            "lazy-fill:apply",
            "lazy-fill:child-fiber",
            "live-receive:apply",
            "live-receive:child-fiber",
            "live-receive:observe-after",
            "live-receive:observe-before",
            "nested-receive:apply",
            "nested-receive:child-fiber",
            "nested-receive:observe-after",
            "nested-receive:observe-before",
          ]);
          for (const { boundary, acknowledge } of seen) {
            expect(acknowledge, boundary).toBe(Effect.void);
          }
        }).pipe(Effect.scoped, Effect.provide(worldIn(schema, inspect, stores)));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("notifies a subscriber only after the snapshot and acknowledgement commit", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* recordTransactions(schema);
      yield* sql`CREATE TABLE ${sql(`${schema}.commit_gate`)} (id int)`;
      yield* sql.unsafe(`
        CREATE FUNCTION ${schema}.block_ack() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.delivery->'target'->>'name' = 'TallyTotals' THEN
            LOCK TABLE ${schema}.commit_gate IN ACCESS EXCLUSIVE MODE;
          END IF;
          RETURN OLD;
        END $$`);
      yield* sql`CREATE TRIGGER block_ack BEFORE DELETE ON ${sql(`${schema}.outbox`)}
        FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.block_ack`)}()`;
      const locked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const blocker = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`LOCK TABLE ${sql(`${schema}.commit_gate`)} IN ACCESS EXCLUSIVE MODE`;
            yield* Deferred.succeed(locked, undefined);
            yield* Deferred.await(release);
          }),
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(locked);
      const stores = new Map<string, ViewStore>();
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        const id = TallyId.make("notify");
        const notifications = yield* Queue.unbounded<ViewSnapshot>();
        const store = stores.get("TallyTotals");
        if (!store) return yield* Effect.die("view store missing");
        yield* store.changes(id).pipe(
          Stream.runForEach((snapshot) => Queue.offer(notifications, snapshot)),
          Effect.forkScoped,
        );
        expect((yield* Queue.take(notifications)).state).toBeNull();
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const receipt = yield* api.AddToTally(id, { amount: 3 });
        yield* until(
          sql`SELECT 1 FROM pg_locks WHERE relation = ${`${schema}.commit_gate`}::regclass AND NOT granted`,
          (rows) => rows.length > 0,
        );
        expect(yield* Queue.size(notifications)).toBe(0);
        expect(yield* sql`SELECT * FROM ${sql(`${schema}.transactions`)}`).toEqual([]);
        expect(
          yield* sql`SELECT snapshot->'state' AS state FROM ${sql(`${schema}.view_keys`)}
            WHERE view = 'TallyTotals' AND key = ${id}`,
        ).toEqual([]);
        expect(
          yield* sql`SELECT * FROM ${sql(`${schema}.view_entries`)} WHERE key = ${id}`,
        ).toEqual([]);
        expect(
          yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}
          WHERE delivery->'target'->>'name' = 'TallyTotals' AND delivery->>'key' = ${id}`,
        ).toEqual([{ attempts: 0, failed_at: null }]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(blocker);
        const snapshot = yield* Queue.take(notifications).pipe(Effect.timeout("5 seconds"));
        expect(snapshot.state).toEqual({ total: 3, adds: 1, closed: false });
        expect(snapshot.checkpoints[receipt.stream]).toBe(receipt.version);
        expect(
          yield* sql`SELECT filled_generation FROM ${sql(`${schema}.view_keys`)}
          WHERE view = 'TallyTotals' AND key = ${id}`,
        ).toEqual([{ filled_generation: 1 }]);
        expect(
          yield* sql`SELECT seq FROM ${sql(`${schema}.view_entries`)} WHERE key = ${id}`,
        ).toEqual([{ seq: 1 }]);
        const committed = yield* sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`;
        expect(committed.map((row) => row.kind).sort()).toEqual(["ack", "view"]);
        expect(new Set(committed.map((row) => row.transaction)).size).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema, (kit) => kit, stores)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("commits the snapshot and acknowledgement together, and acknowledges duplicates", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* recordTransactions(schema);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        const id = TallyId.make("atomic");
        expect(yield* api.TallyTotals.get(id)).toBeNull();
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const receipt = yield* api.AddToTally(id, { amount: 3 });
        yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
        expect(yield* sql`SELECT * FROM ${sql(`${schema}.transactions`)}`).toEqual([]);
        expect(yield* sql`SELECT * FROM ${sql(`${schema}.view_keys`)} WHERE key = ${id}`).toEqual(
          [],
        );
        expect(
          yield* sql`SELECT * FROM ${sql(`${schema}.view_entries`)} WHERE key = ${id}`,
        ).toEqual([]);
        expect(
          yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}
          WHERE delivery->'target'->>'name' = 'TallyTotals' AND delivery->>'key' = ${id}`,
        ).toEqual([{ attempts: 0, failed_at: null }]);
        yield* Deferred.succeed(release, undefined);
        const records = yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.some((row) => row.kind === "ack"),
        );
        expect(records.map((row) => row.kind).sort()).toEqual(["ack", "view"]);
        expect(new Set(records.map((row) => row.transaction)).size).toBe(1);
        expect(yield* api.TallyTotals.get(id, { atLeast: receipt })).toEqual({
          total: 3,
          adds: 1,
          closed: false,
        });
        const delivery = records.find((row) => row.kind === "ack")?.delivery;
        expect(delivery).toBeDefined();
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Tallies', ${sql.json(delivery)})`;
        const replayed = yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.filter((row) => row.kind === "ack").length === 2,
        );
        expect(replayed.filter((row) => row.kind === "view")).toHaveLength(1);
        expect(yield* api.TallyTotals.get(id)).toEqual({ total: 3, adds: 1, closed: false });
      }).pipe(
        Effect.scoped,
        Effect.provide(
          worldIn(schema, (kit) => ({
            ...kit,
            apply: (key, snapshot, deliveries) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return yield* kit.apply(key, snapshot, deliveries);
              }),
          })),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("rolls back a failed acknowledgement and recovers automatically", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* recordTransactions(schema);
      yield* sql`CREATE SEQUENCE ${sql(`${schema}.ack_attempts`)}`;
      yield* sql.unsafe(`
        CREATE FUNCTION ${schema}.reject_ack() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.delivery->'target'->>'name' = 'TallyTotals' THEN
            PERFORM nextval('${schema}.ack_attempts');
            RAISE EXCEPTION 'test acknowledgement failure';
          END IF;
          RETURN OLD;
        END $$`);
      yield* sql`CREATE TRIGGER reject_ack BEFORE DELETE ON ${sql(`${schema}.outbox`)}
        FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.reject_ack`)}()`;
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        const id = TallyId.make("rollback");
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const receipt = yield* api.AddToTally(id, { amount: 3 });
        yield* until(
          sql<{ last_value: string; is_called: boolean }>`SELECT last_value, is_called
            FROM ${sql(`${schema}.ack_attempts`)}`,
          (rows) => rows[0]?.is_called === true && Number(rows[0].last_value) >= 2,
        );
        expect(
          yield* sql<{ attempts: number; failed_at: number | null }>`SELECT attempts, failed_at
            FROM ${sql(`${schema}.outbox`)}
            WHERE delivery->'target'->>'name' = 'TallyTotals'`,
        ).toEqual([{ attempts: 0, failed_at: null }]);
        expect(yield* sql`SELECT * FROM ${sql(`${schema}.transactions`)}`).toEqual([]);
        expect(
          yield* sql`SELECT snapshot FROM ${sql(`${schema}.view_keys`)}
            WHERE view = 'TallyTotals' AND key = ${id}`,
        ).toEqual([]);
        yield* sql`DROP TRIGGER reject_ack ON ${sql(`${schema}.outbox`)}`;
        const recovered = yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.some((row) => row.kind === "ack"),
        );
        expect(recovered.map((row) => row.kind).sort()).toEqual(["ack", "view"]);
        expect(new Set(recovered.map((row) => row.transaction)).size).toBe(1);
        expect(yield* api.TallyTotals.get(id, { atLeast: receipt })).toEqual({
          total: 3,
          adds: 1,
          closed: false,
        });
        expect(
          yield* sql`SELECT * FROM ${sql(`${schema}.outbox`)} WHERE failed_at IS NOT NULL`,
        ).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

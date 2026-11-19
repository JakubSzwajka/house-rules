import { emptySnapshot, type ViewKit } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { PgForTests, testSchema } from "../from-env.ts";
import { TallyApi, TallyId } from "./tally.ts";
import {
  onPostgres,
  type Record,
  recordTransactions,
  until,
  worldIn,
} from "./view-delivery-fixture.ts";

describe.skipIf(!onPostgres)("ordered view deliveries", () => {
  for (const outcome of ["retry", "park"] as const) {
    it.live(`blocks later rows of the same stream until the failing row can ${outcome}`, () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* recordTransactions(schema);
        const first = yield* Deferred.make<void>();
        const failFirst = yield* Deferred.make<void>();
        const retry = yield* Deferred.make<void>();
        const finishRetry = yield* Deferred.make<void>();
        const attempted: Array<number> = [];
        let repaired = false;
        const inspect = (kit: ViewKit): ViewKit => ({
          ...kit,
          apply: (key, snapshot, deliveries) =>
            Effect.gen(function* () {
              const seq = deliveries[0]?.seq;
              if (seq === undefined) return yield* Effect.die("delivery missing");
              if (seq >= 3) attempted.push(seq);
              if (seq === 3) {
                if (attempted.length === 1) {
                  yield* Deferred.succeed(first, undefined);
                  yield* Deferred.await(failFirst);
                  return yield* Effect.die("first row fails");
                }
                yield* Deferred.succeed(retry, undefined);
                yield* Deferred.await(finishRetry);
                if (outcome === "park" && !repaired)
                  return yield* Effect.die("first row fails again");
              }
              return yield* kit.apply(key, snapshot, deliveries);
            }),
        });
        yield* Effect.gen(function* () {
          const api = yield* TallyApi.clientInProcess;
          const id = TallyId.make(`ordered-${outcome}`);
          yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
          const initial = yield* api.AddToTally(id, { amount: 1 });
          yield* api.TallyTotals.get(id, { atLeast: initial });
          const records = yield* until(
            sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
            (rows) => rows.some((row) => row.kind === "ack"),
          );
          const delivery = records.find((row) => row.kind === "ack")?.delivery;
          if (!delivery) return yield* Effect.die("acknowledged delivery missing");
          const viewWritesBefore = (yield* sql<Record>`
            SELECT * FROM ${sql(`${schema}.transactions`)}`).filter(
            (row) => row.kind === "view",
          ).length;
          const failing = {
            ...delivery,
            seq: 3,
            envelope: { ...delivery.envelope, seq: 3 },
            event: { _tag: "TallyAdded", amount: 2, total: 3 },
          };
          const later = {
            ...delivery,
            seq: 4,
            envelope: { ...delivery.envelope, seq: 4 },
            event: { _tag: "TallyAdded", amount: 3, total: 6 },
          };
          // Insert both rows together so one outbox pass sees the whole ordered batch.
          yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
            VALUES ('Tallies', ${sql.json(failing)}), ('Tallies', ${sql.json(later)})`;
          yield* Deferred.await(first);
          yield* Deferred.succeed(failFirst, undefined);
          yield* Deferred.await(retry).pipe(Effect.timeout("5 seconds"));
          if (outcome === "retry") {
            expect(attempted).toEqual([3, 3]);
            const pending = yield* sql<{ attempts: number; seq: number }>`
              SELECT attempts, (delivery->>'seq')::int AS seq FROM ${sql(`${schema}.outbox`)}
              WHERE delivery->'target'->>'name' = 'TallyTotals' ORDER BY position`;
            expect(pending).toEqual([
              { attempts: 1, seq: 3 },
              { attempts: 0, seq: 4 },
            ]);
            const transactions = yield* sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`;
            expect(transactions.filter((row) => row.kind === "view")).toHaveLength(
              viewWritesBefore,
            );
            yield* Deferred.succeed(finishRetry, undefined);
            yield* until(
              sql`SELECT 1 FROM ${sql(`${schema}.outbox`)}
                WHERE delivery->'target'->>'name' = 'TallyTotals'`,
              (rows) => rows.length === 0,
            );
            expect(yield* api.TallyTotals.get(id)).toEqual({ total: 6, adds: 3, closed: false });
            expect(attempted).toEqual([3, 3, 4]);
            const parked = yield* sql<{ attempts: number; failed_at: string | null }>`
              SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}
              WHERE delivery->'target'->>'name' = 'TallyTotals'`;
            expect(parked).toEqual([]);
          } else {
            yield* Deferred.succeed(finishRetry, undefined);
            const parked = yield* until(
              sql<{ position: string; seq: number; attempts: number; failed_at: string | null }>`
                SELECT position, (delivery->>'seq')::int AS seq, attempts, failed_at
                FROM ${sql(`${schema}.outbox`)}
                WHERE delivery->'target'->>'name' = 'TallyTotals' ORDER BY position`,
              (rows) => rows.some((row) => row.seq === 3 && row.failed_at !== null),
            );
            expect(attempted).toEqual([3, 3]);
            expect(parked).toMatchObject([
              { seq: 3, attempts: 2 },
              { seq: 4, attempts: 0, failed_at: null },
            ]);
            expect(parked[0]?.failed_at).not.toBeNull();
            const parkedRow = parked[0];
            if (!parkedRow) return yield* Effect.die("parked row missing");
            expect(yield* api.TallyTotals.get(id, { atLeast: initial })).toEqual({
              total: 1,
              adds: 1,
              closed: false,
            });
            repaired = true;
            yield* sql`UPDATE ${sql(`${schema}.outbox`)} SET failed_at = NULL, attempts = 0
              WHERE position = ${parkedRow.position}`;
            yield* until(
              sql`SELECT 1 FROM ${sql(`${schema}.outbox`)}
                WHERE delivery->'target'->>'name' = 'TallyTotals'`,
              (rows) => rows.length === 0,
            );
            expect(attempted).toEqual([3, 3, 3, 4]);
            expect(yield* api.TallyTotals.get(id)).toEqual({ total: 6, adds: 3, closed: false });
          }
        }).pipe(Effect.scoped, Effect.provide(worldIn(schema, inspect)));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );
  }

  it.live("resets generation storage, acknowledges older deliveries and retries newer ones", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* recordTransactions(schema);
      yield* sql`INSERT INTO ${sql(`${schema}.views`)} (model, view, generation)
        VALUES ('Tallies', 'TallyTotals', 0)`;
      yield* sql`INSERT INTO ${sql(`${schema}.view_keys`)} (model, view, key, snapshot)
        VALUES ('Tallies', 'TallyTotals', 'stale', ${sql.json({ ...emptySnapshot, state: { total: 99 } })})`;
      const retrying = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let newerAttempts = 0;
      const inspect = (kit: ViewKit): ViewKit => ({
        ...kit,
        apply: (key, snapshot, deliveries) =>
          Effect.gen(function* () {
            if (deliveries[0]?.target.generation === kit.generation + 1) {
              newerAttempts += 1;
              if (newerAttempts === 2) {
                yield* Deferred.succeed(retrying, undefined);
                yield* Deferred.await(release);
              }
            }
            return yield* kit.apply(key, snapshot, deliveries);
          }),
      });
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        expect(yield* sql`SELECT * FROM ${sql(`${schema}.view_keys`)}`).toEqual([]);
        const id = TallyId.make("generation");
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const receipt = yield* api.AddToTally(id, { amount: 3 });
        yield* api.TallyTotals.get(id, { atLeast: receipt });
        const original = yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.some((row) => row.kind === "ack"),
        );
        const delivery = original.find((row) => row.kind === "ack")?.delivery;
        if (!delivery) return yield* Effect.die("acknowledged delivery missing");
        expect(delivery.target.generation).toBe(1);
        const before = yield* sql`SELECT snapshot FROM ${sql(`${schema}.view_keys`)}`;
        const snapshotWritesBefore =
          (yield* sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`).filter(
            (row) => row.kind === "view",
          ).length;
        const older = {
          ...delivery,
          seq: delivery.seq + 1,
          target: { ...delivery.target, generation: 0 },
        };
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Tallies', ${sql.json(older)})`;
        yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.filter((row) => row.kind === "ack").length === 2,
        );
        expect(yield* sql`SELECT snapshot FROM ${sql(`${schema}.view_keys`)}`).toEqual(before);
        const afterOlder = yield* sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`;
        expect(afterOlder.filter((row) => row.kind === "view")).toHaveLength(snapshotWritesBefore);
        const newer = {
          ...delivery,
          seq: delivery.seq + 2,
          target: { ...delivery.target, generation: 2 },
        };
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Tallies', ${sql.json(newer)})`;
        yield* Deferred.await(retrying).pipe(Effect.timeout("5 seconds"));
        const pending = yield* sql<{ attempts: number; failed_at: string | null }>`
          SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}
          WHERE delivery->'target'->>'name' = 'TallyTotals'`;
        expect(pending).toEqual([{ attempts: 1, failed_at: null }]);
        expect(yield* sql`SELECT snapshot FROM ${sql(`${schema}.view_keys`)}`).toEqual(before);
        const records = yield* sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`;
        expect(records.filter((row) => row.kind === "ack")).toHaveLength(2);
        expect(records.filter((row) => row.kind === "view")).toHaveLength(snapshotWritesBefore);
        yield* Deferred.succeed(release, undefined);
        yield* until(
          sql`SELECT 1 FROM ${sql(`${schema}.outbox`)} WHERE failed_at IS NOT NULL`,
          (rows) => rows.length === 1,
        );
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema, inspect)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

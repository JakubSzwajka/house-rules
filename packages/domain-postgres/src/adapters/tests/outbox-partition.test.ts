import type { Delivery, ViewKit } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { PgForTests, testSchema } from "../from-env.ts";
import { makeOutbox } from "../outbox.ts";
import type { Monitor } from "../outbox-status.ts";
import { migrate } from "../tables.ts";
import { TallyApi, TallyId } from "./tally.ts";
import {
  onPostgres,
  type Record,
  recordTransactions,
  until,
  worldIn,
} from "./view-delivery-fixture.ts";

describe.skipIf(!onPostgres)("parked outbox partitions", () => {
  it.live("counts parked rows and lets other generations, placements and keys progress", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* migrate(schema);
      const table = sql(`${schema}.outbox`);
      const base: Delivery = {
        target: { kind: "view", name: "Consumer", generation: 1 },
        key: "one",
        source: "Source/one",
        seq: 1,
        origin: "Source",
        tag: "Changed",
        event: { _tag: "Changed" },
        envelope: { id: "one", stream: "Source/one", seq: 1, at: 1, commandId: "one" },
      };
      const blocked = { ...base, seq: 2, target: { ...base.target, inPlace: false } };
      const nextGeneration = { ...blocked, target: { ...base.target, generation: 2 } };
      const nextPlacement = { ...blocked, target: { ...base.target, inPlace: true } };
      yield* sql`INSERT INTO ${table} (model, delivery) VALUES
        ('Partitions', ${sql.json(base)}), ('Partitions', ${sql.json(blocked)}),
        ('Partitions', ${sql.json(nextGeneration)}), ('Partitions', ${sql.json(nextPlacement)})`;
      const wake = yield* Queue.sliding<void>(1);
      const monitors: Array<Monitor> = [];
      const attempted: Array<Delivery> = [];
      yield* makeOutbox({
        sql,
        table: `${schema}.outbox`,
        model: "Partitions",
        wake,
        pollInterval: "20 millis",
        maxAttempts: 1,
        outboxStatus: (_model, monitor) => monitors.push(monitor),
        deliver: (item, acknowledge) =>
          Effect.gen(function* () {
            attempted.push(item);
            if (item.seq === 1) return yield* Effect.die("park this generation");
            yield* acknowledge;
          }),
      }).pipe(Effect.forkScoped);
      yield* until(
        Effect.sync(() => monitors.length),
        (count) => count === 1,
      );
      const monitor = monitors[0];
      if (!monitor) return yield* Effect.die("monitor missing");
      yield* until(monitor.snapshot, (status) => status.available && status.parkedCount === 1);
      expect((yield* monitor.snapshot).pendingCount).toBe(1);
      expect(attempted).toEqual([base, nextGeneration, nextPlacement]);
      const anotherSource = { ...blocked, source: "Source/two" };
      const anotherKey = { ...blocked, key: "two" };
      yield* sql`INSERT INTO ${table} (model, delivery)
        VALUES ('Partitions', ${sql.json(anotherSource)}), ('Partitions', ${sql.json(anotherKey)})`;
      yield* until(
        sql`SELECT * FROM ${table} WHERE delivery->>'key' = 'two'`,
        (rows) => rows.length === 0,
      );
      const status = yield* until(monitor.snapshot, (value) => value.pendingCount === 2);
      expect(status.parkedCount).toBe(1);
      expect(attempted).toEqual([base, nextGeneration, nextPlacement, anotherKey]);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("blocks a parked view key across batches and resumes it without checkpoint loss", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* recordTransactions(schema);
      const id = TallyId.make("parked");
      const other = TallyId.make("other");
      let repaired = false;
      const attempted: Array<number> = [];
      const inspect = (kit: ViewKit): ViewKit => ({
        ...kit,
        apply: (key, snapshot, deliveries) =>
          Effect.gen(function* () {
            const seq = deliveries[0]?.seq;
            if (key === id && seq !== undefined && seq >= 3) {
              attempted.push(seq);
              if (seq === 3 && !repaired) return yield* Effect.die("repair required");
            }
            return yield* kit.apply(key, snapshot, deliveries);
          }),
      });
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const receipt = yield* api.AddToTally(id, { amount: 1 });
        yield* api.TallyTotals.get(id, { atLeast: receipt });
        const records = yield* until(
          sql<Record>`SELECT * FROM ${sql(`${schema}.transactions`)}`,
          (rows) => rows.some((row) => row.kind === "ack"),
        );
        const original = records.find((row) => row.kind === "ack")?.delivery;
        if (!original) return yield* Effect.die("delivery missing");
        const next = (seq: number, key = id) => ({
          ...original,
          key,
          seq,
          envelope: { ...original.envelope, seq },
          event: { _tag: "TallyAdded", amount: 1, total: seq },
        });
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Tallies', ${sql.json(next(3))}), ('Tallies', ${sql.json(next(4))}),
            ('Tallies', ${sql.json(next(3, other))})`;
        yield* until(
          sql`SELECT * FROM ${sql(`${schema}.outbox`)} WHERE failed_at IS NOT NULL`,
          (rows) => rows.length === 1,
        );
        yield* api.TallyTotals.get(other, { atLeast: { stream: original.source, version: 3 } });
        expect(attempted).toEqual([3, 3]);
        expect(yield* api.TallyTotals.get(id)).toEqual({ total: 1, adds: 1, closed: false });
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Tallies', ${sql.json(next(5))}), ('Tallies', ${sql.json(next(4, other))})`;
        yield* api.TallyTotals.get(other, { atLeast: { stream: original.source, version: 4 } });
        expect(attempted).toEqual([3, 3]);
        expect(
          yield* sql`SELECT (delivery->>'seq')::int AS seq FROM ${sql(`${schema}.outbox`)}
            WHERE delivery->>'key' = ${id} ORDER BY position`,
        ).toEqual([{ seq: 3 }, { seq: 4 }, { seq: 5 }]);
        repaired = true;
        yield* sql`UPDATE ${sql(`${schema}.outbox`)} SET attempts = 0, failed_at = NULL
          WHERE failed_at IS NOT NULL`;
        expect(
          yield* api.TallyTotals.get(id, { atLeast: { stream: original.source, version: 5 } }),
        ).toEqual({ total: 5, adds: 4, closed: false });
        expect(attempted).toEqual([3, 3, 3, 4, 5]);
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema, inspect)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

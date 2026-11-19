import * as Domain from "@alchemy.run/domain";
import type { Delivery } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { PgForTests, testSchema } from "../from-env.ts";
import { checkTables, migrate } from "../tables.ts";
import { drained, Mark, Marks, replayOrder, seed, world } from "./backfill-fixture.ts";

describe.skipIf(process.env["DOMAIN_STORE"] === "memory")("generation backfill on Postgres", () => {
  it.each([false, true])("verifies the source graph with lazy dependency %s", (mirrorLazy) => {
    const model = world("unused", 2, [], undefined, undefined, { mirrorLazy });
    expect(Domain.verify(model.definition)).toEqual([]);
  });

  it.live("rebuilds snapshots and entries through kernel routing without history policies", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      const deliveries: Delivery[] = [];
      yield* seed(schema, 4, deliveries);
      const duplicate = deliveries.find((delivery) => delivery.target.name === "Collected");
      expect(duplicate).toBeDefined();
      yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
        VALUES ('Backfilled', ${sql.json(duplicate)})`;
      yield* sql`UPDATE ${sql(`${schema}.events`)}
        SET envelope = jsonb_set(envelope, '{at}', to_jsonb((10 - seq)::bigint))`;
      const effects: string[] = [];
      const next = world(schema, 2, effects);
      yield* Effect.gen(function* () {
        const collected = yield* next.Collected;
        const individual = yield* next.Individual;
        const mirrored = yield* next.Mirrored;
        expect((yield* collected.snapshot("all")).state).toEqual(["2:0", "2:2", "2:1", "2:3"]);
        expect((yield* individual.snapshot(Marks.ref("a"))).state).toEqual(["2:0", "2:2"]);
        expect((yield* mirrored.snapshot("all")).state).toEqual(replayOrder(4));
        expect(
          (yield* collected.list("all", { take: 200 })).entries.map((entry) => entry.event.value),
        ).toEqual(replayOrder(4));
        expect(
          (yield* mirrored.list("all", { take: 200 })).entries.map((entry) => entry.event.value),
        ).toEqual(replayOrder(4));
        expect(yield* collected.history).toEqual({ complete: true });
        const verified = yield* sql<{ routed: string; applied: string; deduped: string }>`
          SELECT routed, applied, deduped FROM ${sql(`${schema}.backfills`)}
          WHERE target LIKE 'view:Collected%' AND routed > 0`;
        expect(
          verified.map((row) => [Number(row.routed), Number(row.applied), Number(row.deduped)]),
        ).toEqual([[4, 4, 0]]);
        yield* drained(schema);
        expect(effects).toEqual([]);
        const marks = yield* Marks;
        yield* marks.send("a", new Mark({ value: "live" }));
        yield* drained(schema);
        expect((yield* collected.snapshot("all")).state).toEqual([
          "2:0",
          "2:2",
          "2:1",
          "2:3",
          "2:live",
        ]);
        expect((yield* collected.list("all", { take: 200 })).entries.length).toBe(5);
        expect((yield* mirrored.list("all", { take: 200 })).entries.length).toBe(5);
        expect(effects).toEqual(["live"]);
      }).pipe(Effect.scoped, Effect.provide(next.live));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live(
    "resumes a durable partial generation after startup interruption and pending live rows",
    () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        const deliveries: Delivery[] = [];
        yield* seed(schema, 132, deliveries);
        const duplicate = deliveries.find((delivery) => delivery.target.name === "Collected");
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
        VALUES ('Backfilled', ${sql.json(duplicate)})`;
        const reached = yield* Deferred.make<void>();
        let applied = 0;
        const blocked = world(schema, 2, [], (kit) =>
          kit.name !== "Collected"
            ? kit
            : {
                ...kit,
                apply: (...args) =>
                  Effect.gen(function* () {
                    if (++applied === 130) {
                      yield* Deferred.succeed(reached, undefined);
                      return yield* Effect.never;
                    }
                    return yield* kit.apply(...args);
                  }),
              },
        );
        const starting = yield* Layer.build(blocked.live).pipe(Effect.scoped, Effect.forkChild);
        yield* Deferred.await(reached).pipe(Effect.timeout("10 seconds"));
        const progress = yield* sql<{
          cursor: { source: string; id: string; seq: number };
          routed: string;
          applied: string;
          deduped: string;
        }>`
          SELECT cursor, routed, applied, deduped FROM ${sql(`${schema}.backfills`)}
          WHERE target LIKE 'view:Collected%' AND NOT complete`;
        expect(
          progress.map((row) => ({
            cursor: row.cursor,
            counts: [Number(row.routed), Number(row.applied), Number(row.deduped)],
          })),
        ).toEqual([{ cursor: { source: "Marks", id: "z", seq: 62 }, counts: [128, 128, 0] }]);
        const partial = yield* sql<{ count: string }>`SELECT count(*) AS count
        FROM ${sql(`${schema}.view_entries`)} WHERE view = 'Collected'`;
        expect(Number(partial[0]?.count)).toBe(128);
        const snapshots = yield* sql<{
          version: number;
        }>`SELECT (snapshot->>'version')::int AS version
        FROM ${sql(`${schema}.view_keys`)} WHERE view = 'Collected' AND key = 'all'`;
        expect(snapshots).toEqual([{ version: 128 }]);
        yield* Fiber.interrupt(starting);
        const effects: string[] = [];
        const resumed = world(schema, 2, effects);
        yield* Effect.gen(function* () {
          const collected = yield* resumed.Collected;
          const mirrored = yield* resumed.Mirrored;
          expect((yield* collected.snapshot("all")).state).toEqual(
            replayOrder(132).map((value) => `2:${value}`),
          );
          expect((yield* collected.list("all", { take: 200 })).entries.length).toBe(132);
          expect((yield* mirrored.snapshot("all")).state).toEqual(replayOrder(132));
          expect((yield* mirrored.list("all", { take: 200 })).entries.length).toBe(132);
          yield* drained(schema);
          expect(effects).toEqual([]);
          expect(yield* collected.history).toEqual({ complete: true });
        }).pipe(Effect.scoped, Effect.provide(resumed.live));
        const complete = yield* sql<{ complete: boolean }>`SELECT complete
        FROM ${sql(`${schema}.backfills`)} WHERE target LIKE 'view:Collected%'`;
        expect(complete).toEqual([{ complete: true }, { complete: true }]);
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    30_000,
  );

  it.live("resumes an existing pending generation by checkpoint deduplication", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* seed(schema, 4);
      yield* sql`UPDATE ${sql(`${schema}.backfills`)} SET complete = false
        WHERE target LIKE 'view:Collected%'`;
      const effects: string[] = [];
      const restarted = world(schema, 1, effects);
      yield* Effect.gen(function* () {
        const collected = yield* restarted.Collected;
        expect((yield* collected.snapshot("all")).state).toEqual(["1:0", "1:1", "1:2", "1:3"]);
        expect((yield* collected.list("all")).entries.length).toBe(4);
        const counts = yield* sql<{ routed: string; applied: string; deduped: string }>`
          SELECT routed, applied, deduped FROM ${sql(`${schema}.backfills`)}
          WHERE target LIKE 'view:Collected%'`;
        expect(
          counts.map((row) => [Number(row.routed), Number(row.applied), Number(row.deduped)]),
        ).toEqual([[4, 0, 4]]);
        expect(yield* collected.history).toEqual({ complete: true });
        yield* drained(schema);
        expect(effects).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(restarted.live));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("locks the aggregate instance before a due schedule row", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      const initial = world(schema, 1, []);
      yield* Effect.gen(function* () {
        const marks = yield* Marks;
        yield* marks.send("a", new Mark({ value: "initial" }));
        yield* marks.schedule("a", new Mark({ value: "scheduled" }), {
          after: "1 hour",
          commandId: "due",
        });
        yield* drained(schema);
      }).pipe(Effect.scoped, Effect.provide(initial.live));
      yield* sql`UPDATE ${sql(`${schema}.schedules`)} SET due_at = 0 WHERE command_id = 'due'`;
      const restarted = world(schema, 1, []);
      const locked = yield* Deferred.make<void>();
      const running = yield* Deferred.await(locked).pipe(
        Effect.andThen(Layer.build(restarted.live)),
        Effect.andThen(Effect.never),
        Effect.scoped,
        Effect.forkChild,
      );
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT 1 FROM ${sql(`${schema}.instances`)}
          WHERE model = 'Backfilled' AND aggregate = 'Marks' AND id = 'a' FOR UPDATE`;
          yield* Deferred.succeed(locked, undefined);
          yield* Effect.gen(function* () {
            yield* sql`SELECT pg_stat_clear_snapshot()`;
            return yield* sql<{ count: string }>`SELECT count(*) AS count FROM pg_stat_activity
              WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE ${`%${schema}%instances%`}`;
          }).pipe(
            Effect.repeat({
              until: (rows) => Number(rows[0]?.count) > 0,
              schedule: Schedule.spaced("10 millis"),
            }),
            Effect.timeout("5 seconds"),
          );
          const removed = yield* sql`DELETE FROM ${sql(`${schema}.schedules`)}
          WHERE command_id = 'due' RETURNING 1`.pipe(Effect.timeout("500 millis"));
          expect(removed.length).toBe(1);
        }),
      );
      yield* Fiber.interrupt(running);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("requires the replay table for old row-only schemas and migrates idempotently", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* migrate(schema);
      yield* sql`INSERT INTO ${sql(`${schema}.views`)} (model, view, generation)
        VALUES ('Legacy', 'Old', 0)`;
      yield* sql`ALTER TABLE ${sql(`${schema}.views`)} DROP COLUMN catch_up`;
      yield* sql`DROP TABLE IF EXISTS ${sql(`${schema}.backfills`)}`;
      yield* sql`ALTER TABLE ${sql(`${schema}.view_keys`)} DROP COLUMN filled_generation`;
      const missing = yield* checkTables(schema).pipe(Effect.flip);
      expect(missing).toMatchObject({
        _tag: "TablesMissing",
        missing: ["backfills", "view_keys.filled_generation", "views.catch_up"],
      });
      yield* migrate(schema);
      yield* migrate(schema);
      yield* checkTables(schema);
      expect(
        yield* sql`SELECT catch_up FROM ${sql(`${schema}.views`)} WHERE model = 'Legacy'`,
      ).toEqual([{ catch_up: null }]);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

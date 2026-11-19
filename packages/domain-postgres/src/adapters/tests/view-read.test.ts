import type { Delivery, ViewStore } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PgForTests, testSchema } from "../from-env.ts";
import type { Monitor } from "../outbox-status.ts";
import { Marks, seed, world } from "./backfill-fixture.ts";
import { onPostgres, until } from "./view-delivery-fixture.ts";

const instrument = (sql: Pg.PgClient) => {
  const queries: string[] = [];
  let transactions = 0;
  return {
    queries,
    get transactions() {
      return transactions;
    },
    reset: () => {
      queries.length = 0;
      transactions = 0;
    },
    sql: new Proxy(sql, {
      apply: (target, receiver, args) => {
        if (Array.isArray(args[0])) queries.push(args[0].join("?"));
        return Reflect.apply(target, receiver, args);
      },
      get: (target, key, receiver) =>
        key === "withTransaction"
          ? <A, E, R>(effect: Effect.Effect<A, E, R>) => {
              transactions += 1;
              return target.withTransaction(effect);
            }
          : Reflect.get(target, key, receiver),
    }),
  };
};

describe.skipIf(!onPostgres)("view read costs and post-commit delivery", () => {
  it.live.each(["read", "receive"] as const)(
    "wakes a healthy idle hour-poll worker after lazy %s commits",
    (first) =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        const deliveries: Delivery[] = [];
        yield* seed(schema, 2, deliveries);
        const original = deliveries.find(
          (delivery) => delivery.target.name === "Individual" && delivery.key === "z",
        );
        if (!original) return yield* Effect.die("seed delivery missing");
        const live = { ...original, target: { ...original.target, generation: 2 } };
        const stores = new Map<string, ViewStore>();
        const monitors: Monitor[] = [];
        const effects: string[] = [];
        const next = world(schema, 2, effects, undefined, undefined, {
          policyLazy: true,
          pollInterval: "1 hour",
          outboxStatus: (_model, monitor) => monitors.push(monitor),
          store: (kit, store) => {
            stores.set(kit.name, store);
            return store;
          },
        });
        yield* Effect.gen(function* () {
          yield* until(
            Effect.sync(() => monitors.length),
            (count) => count === 1,
          );
          const store = stores.get("Individual");
          const monitor = monitors[0];
          if (!store || !monitor) return yield* Effect.die("active host missing");
          yield* until(
            monitor.snapshot,
            (status) => status.alive && status.available && status.pendingCount === 0,
          );
          yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
            VALUES ('Backfilled', ${sql.json(live)})`;
          if (first === "read") yield* store.read("z");
          else yield* store.receive("z", [live]);
          yield* until(
            Effect.sync(() => effects),
            (seen) => seen.length === 1,
          ).pipe(Effect.timeout("2 seconds"));
          expect(effects).toEqual(["1"]);
          yield* until(sql`SELECT * FROM ${sql(`${schema}.outbox`)}`, (rows) => rows.length === 0);
          expect((yield* monitor.snapshot).alive).toBe(true);
        }).pipe(Effect.scoped, Effect.provide(next.live));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live.each(["Collected", "Individual"] as const)(
    "reads filled %s keys without transactions or write/locking queries",
    (name) =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        yield* seed(schema, 2);
        const measured = instrument(yield* Pg.PgClient);
        const stores = new Map<string, ViewStore>();
        const monitors: Monitor[] = [];
        const next = world(schema, 2, [], undefined, undefined, {
          pollInterval: "1 hour",
          outboxStatus: (_model, monitor) => monitors.push(monitor),
          store: (kit, store) => {
            stores.set(kit.name, store);
            return store;
          },
        });
        yield* Effect.gen(function* () {
          yield* until(
            Effect.sync(() => monitors.length),
            (count) => count === 1,
          );
          const store = stores.get(name);
          const monitor = monitors[0];
          if (!store || !monitor) return yield* Effect.die("active host missing");
          yield* until(
            monitor.snapshot,
            (status) => status.alive && status.available && status.pendingCount === 0,
          );
          const key = name === "Individual" ? "a" : "all";
          yield* store.read(key);
          measured.reset();
          expect((yield* store.read(key)).version).toBeGreaterThan(0);
          expect((yield* store.list(key)).length).toBeGreaterThan(0);
          expect(measured.transactions).toBe(0);
          expect(
            measured.queries.filter((query) => /INSERT|UPDATE|FOR UPDATE/.test(query)),
          ).toEqual([]);
          expect(
            measured.queries.filter((query) => /SELECT snapshot|SELECT entry/.test(query)),
          ).toHaveLength(2);
          expect(
            measured.queries.filter((query) =>
              /SELECT snapshot|SELECT entry|SELECT filled_generation/.test(query),
            ),
          ).toHaveLength(name === "Collected" ? 2 : 4);
        }).pipe(
          Effect.scoped,
          Effect.provide(next.live.pipe(Layer.provide(Layer.succeed(Pg.PgClient, measured.sql)))),
        );
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("does not persist unknown lazy keys with no source events", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* seed(schema, 1);
      const next = world(schema, 2, []);
      yield* Effect.gen(function* () {
        const view = yield* next.Individual;
        yield* view.snapshot(Marks.ref("unknown"));
        yield* view.list(Marks.ref("unknown"));
        expect(
          yield* sql`SELECT key FROM ${sql(`${schema}.view_keys`)}
          WHERE view = 'Individual' AND key = 'unknown'`,
        ).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(next.live));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

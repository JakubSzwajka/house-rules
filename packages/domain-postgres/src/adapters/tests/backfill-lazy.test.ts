import type { Delivery, ModelHost } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { PgForTests, testSchema } from "../from-env.ts";
import { drained, Mark, Marks, replayOrder, seed, world } from "./backfill-fixture.ts";

describe.skipIf(process.env["DOMAIN_STORE"] === "memory")(
  "lazy generation backfill on Postgres",
  () => {
    it.live.each(["snapshot", "list", "watch", "events"] as const)(
      "fills a lazy key on %s and fills another key before its first live receive",
      (read) =>
        Effect.gen(function* () {
          const schema = yield* testSchema;
          const sql = yield* Pg.PgClient;
          yield* seed(schema, 6);
          let history: NonNullable<ModelHost["history"]> = () =>
            Effect.succeed({ complete: false });
          let target = "";
          const deliveries: Delivery[] = [];
          const effects: string[] = [];
          const next = world(
            schema,
            2,
            effects,
            (kit) => {
              if (kit.name === "Individual") target = kit.target;
              return kit;
            },
            (delivery) => deliveries.push(delivery),
            {
              host: (host) => {
                history = host.history ?? history;
              },
            },
          );
          yield* Effect.gen(function* () {
            const individual = yield* next.Individual;
            const entries = yield* sql<{ count: string }>`SELECT count(*) AS count
            FROM ${sql(`${schema}.view_entries`)} WHERE view = 'Individual'`;
            expect(Number(entries[0]?.count)).toBe(0);
            expect(yield* history(target)).toEqual({ complete: false });
            const a = Marks.ref("a");
            if (read === "snapshot") yield* individual.snapshot(a);
            else if (read === "list") yield* individual.list(a);
            else if (read === "watch") yield* individual.watch(a).pipe(Stream.runHead);
            else yield* individual.events(a).pipe(Stream.runHead);
            expect((yield* individual.snapshot(a)).state).toEqual(["2:0", "2:2", "2:4"]);
            expect(yield* history(target)).toEqual({ complete: false });
            const marks = yield* Marks;
            yield* marks.send("z", new Mark({ value: "live" }));
            yield* drained(schema);
            const duplicate = deliveries.find((delivery) => delivery.target.name === "Individual");
            expect(duplicate).toBeDefined();
            yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
            VALUES ('Backfilled', ${sql.json(duplicate)})`;
            yield* drained(schema);
            expect((yield* individual.snapshot(Marks.ref("z"))).state).toEqual([
              "2:1",
              "2:3",
              "2:5",
              "2:live",
            ]);
            expect((yield* individual.list(Marks.ref("z"))).entries.length).toBe(4);
            expect(yield* history(target)).toEqual({ complete: true });
            expect(effects).toEqual(["live"]);
          }).pipe(Effect.scoped, Effect.provide(next.live));
        }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );

    it.live.each(["receive", "read"] as const)(
      "preserves live view-derived policies when lazy %s fills a key first",
      (first) =>
        Effect.gen(function* () {
          const schema = yield* testSchema;
          yield* seed(schema, 6);
          const blocked = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const effects: string[] = [];
          const next = world(schema, 2, effects, undefined, undefined, {
            policyLazy: true,
            store: (kit, store) =>
              kit.name !== "Individual" || first !== "read"
                ? store
                : {
                    ...store,
                    receive: (key, deliveries) =>
                      Effect.gen(function* () {
                        yield* Deferred.succeed(blocked, undefined);
                        yield* Deferred.await(release);
                        yield* store.receive(key, deliveries);
                      }),
                  },
          });
          yield* Effect.gen(function* () {
            const marks = yield* Marks;
            const individual = yield* next.Individual;
            yield* individual.snapshot(Marks.ref("a"));
            expect(effects).toEqual([]);
            yield* marks.send("z", new Mark({ value: "live" }));
            if (first === "read") {
              yield* Deferred.await(blocked).pipe(Effect.timeout("5 seconds"));
              expect((yield* individual.snapshot(Marks.ref("z"))).state).toEqual([
                "2:1",
                "2:3",
                "2:5",
                "2:live",
              ]);
              yield* Deferred.succeed(release, undefined);
            }
            yield* drained(schema);
            expect(effects).toEqual(["live"]);
            expect((yield* individual.list(Marks.ref("z"))).entries.length).toBe(4);
          }).pipe(Effect.scoped, Effect.provide(next.live));
        }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );

    it.live("fills lazy source keys before rebuilding a downstream view", () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        yield* seed(schema, 4);
        const next = world(schema, 2, [], undefined, undefined, { mirrorLazy: true });
        yield* Effect.gen(function* () {
          const mirrored = yield* next.Mirrored;
          expect((yield* mirrored.snapshot("all")).state).toEqual(replayOrder(4));
          expect((yield* mirrored.list("all")).entries.length).toBe(4);
          expect(yield* mirrored.history).toEqual({ complete: true });
        }).pipe(Effect.scoped, Effect.provide(next.live));
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );
  },
);

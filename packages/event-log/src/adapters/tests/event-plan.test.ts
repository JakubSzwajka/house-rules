import { PgClient } from "@effect/sql-pg/PgClient";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Statement } from "effect/sql";
import { EventStore } from "../../index.js";
import { stores } from "./stores.js";

const postgres = stores[0];
layer(postgres.layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "Event selection query plans",
  (it) => {
    it.effect(
      "uses indexed cursor ranges and replay lookups on 200k events",
      () =>
        Effect.gen(function* () {
          const sql = yield* PgClient;
          const store = yield* EventStore;
          yield* sql`insert into event_log_events (id, kind, subject_kind, subject_id, payload, occurred_at)
          select id, case when id = 200000 then 'sparse' when id % 2 = 0 then 'plan-a' else 'plan-b' end, 'task', 't1', '{}', 0
          from generate_series(1, 200000) id`;
          yield* sql`insert into event_log_consumers (name, cursor) values ('plan', 199990)`;
          yield* sql`analyze event_log_events`;
          yield* sql`analyze event_log_consumers`;
          const queries: Array<readonly [string, ReadonlyArray<unknown>]> = [];
          const capture: Statement.Transformer = (statement) =>
            Effect.sync(() => {
              queries.push(statement.compile());
              return statement;
            });
          const next = yield* store
            .candidate("plan", ["plan-a", "plan-b", "absent"])
            .pipe(Effect.provideService(Statement.CurrentTransformer, capture));
          expect(next?.event.id).toBe("199991");
          expect(queries).toHaveLength(2);
          const explain = Effect.fn("explain")(function* () {
            const plans: Array<string> = [];
            // Disabling seq scans would hide the regression; keep planner defaults.
            for (const [query, params] of queries) {
              const rows = yield* sql
                .unsafe(`explain (analyze, buffers) ${query}`, params)
                .pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.String })),
                    ),
                  ),
                );
              const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
              expect(plan).not.toMatch(/Seq Scan on event_log_events/);
              plans.push(plan);
            }
            return plans;
          });
          const plans = yield* explain();
          expect(plans[1]).toMatch(/Index (?:Only )?Scan using event_log_events_/);
          expect(plans[1]).toMatch(/Index Cond:.*(?:id >|ROW\(kind, id\) >)/);
          // With few kinds, sparse/missing lookups must not filter a full primary-key walk.
          yield* sql`insert into event_log_consumers (name, cursor) values ('sparse-plan', 0)`;
          for (const kind of ["sparse", "absent"]) {
            queries.length = 0;
            const candidate = yield* store
              .candidate("sparse-plan", [kind])
              .pipe(Effect.provideService(Statement.CurrentTransformer, capture));
            expect(candidate?.event.id).toBe(kind === "sparse" ? "200000" : undefined);
            expect(queries).toHaveLength(2);
            const sparsePlans = yield* explain();
            expect(sparsePlans[1]).toMatch(
              /Index (?:Only )?Scan using event_log_events_kind_cursor/,
            );
            expect(sparsePlans[1]).toMatch(/Index Cond:.*kind = k.kind/);
            expect(sparsePlans[1]).toMatch(/Index Cond:.*ROW\(kind, id\) >/);
            expect(sparsePlans[1]).not.toMatch(/Rows Removed by Filter: [1-9][0-9]{2,}/);
          }
          queries.length = 0;
          yield* sql`insert into event_log_pending (consumer, event_id, attempts, next_due, replay, generation, last_error)
          values ('plan', 1, 0, 0, true, 'replay', 'safe')`;
          const replay = yield* store
            .candidate("plan", ["plan-a", "plan-b"])
            .pipe(Effect.provideService(Statement.CurrentTransformer, capture));
          expect(replay).toMatchObject({ event: { id: "1" }, replay: true });
          expect(queries).toHaveLength(1);
          const replayPlans = yield* explain();
          expect(replayPlans[0]).toContain("event_log_events_pkey");
        }),
      { timeout: 30_000 },
    );
  },
);

import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { layer } from "../postgres-platform.ts";
import { PgForTests, testSchema } from "../from-env.ts";
import { Audit, Tally, TalliesLive, TallyApi, TallyId } from "./tally.ts";

const onPostgres = process.env["DOMAIN_STORE"] !== "memory";

const worldIn = (schema: string) =>
  TalliesLive.pipe(Layer.provideMerge(layer({ schema, pollInterval: "100 millis" })));

describe.skipIf(!onPostgres)("the Postgres platform across a restart", () => {
  it.live("keeps state, views, deliveries and pending schedules", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const id = TallyId.make("r-1");

      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        yield* api.OpenTally(id, { closeAfterMillis: 1_500 });
        yield* api.AddToTally(id, { amount: 7 });
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema)));

      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        const tallies = yield* Tally;
        expect(yield* tallies.state(id)).toEqual({ _tag: "Open", total: 7 });
        const audits = yield* Audit;
        const audit = yield* audits.state(id).pipe(
          Effect.filterOrFail((state) => state.count === 1),
          Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
        );
        expect(audit).toEqual({ count: 1 });
        const closed = yield* api.TallyTotals.watch(id).pipe(
          Stream.filter(({ state }) => state?.closed === true),
          Stream.runHead,
          Effect.timeout("5 seconds"),
          Effect.map(Option.getOrUndefined),
        );
        expect(closed?.state).toEqual({ total: 7, adds: 1, closed: true });

        const sql = yield* Pg.PgClient;
        const events = yield* sql<{ count: string }>`
          SELECT count(*) AS count FROM ${sql(`${schema}.events`)} WHERE aggregate = 'Tally'`;
        expect(Number(events[0]?.count)).toBe(3);
        const pending = yield* sql<{ count: string }>`
          SELECT count(*) AS count FROM ${sql(`${schema}.outbox`)}`.pipe(
          Effect.map((rows) => Number(rows[0]?.count)),
          Effect.filterOrFail((count) => count === 0),
          Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
        );
        expect(pending).toBe(0);
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

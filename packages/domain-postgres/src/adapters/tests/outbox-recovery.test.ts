import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { PgForTests, testSchema } from "../from-env.ts";
import { TallyApi, TallyId } from "./tally.ts";
import { onPostgres, recordTransactions, until, worldIn } from "./view-delivery-fixture.ts";

describe.skipIf(!onPostgres)("outbox database recovery", () => {
  it.live("retries failed view SQL without parking and recovers on the same host", () =>
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
            RAISE EXCEPTION 'test acknowledgement unavailable';
          END IF;
          RETURN OLD;
        END $$`);
      yield* Effect.gen(function* () {
        const api = yield* TallyApi.clientInProcess;
        const id = TallyId.make("sql-recovery");
        yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
        const healthy = yield* api.AddToTally(id, { amount: 1 });
        yield* api.TallyTotals.get(id, { atLeast: healthy });
        yield* until(
          sql`SELECT * FROM ${sql(`${schema}.outbox`)}
            WHERE delivery->'target'->>'name' = 'TallyTotals'`,
          (rows) => rows.length === 0,
        );
        yield* sql`CREATE TRIGGER reject_ack BEFORE DELETE ON ${sql(`${schema}.outbox`)}
          FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.reject_ack`)}()`;
        const receipt = yield* api.AddToTally(id, { amount: 2 });
        yield* until(
          sql<{ last_value: string }>`SELECT last_value FROM ${sql(`${schema}.ack_attempts`)}`,
          (rows) => Number(rows[0]?.last_value) >= 2,
        );
        expect(
          yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}
            WHERE delivery->'target'->>'name' = 'TallyTotals'`,
        ).toEqual([{ attempts: 0, failed_at: null }]);
        expect(yield* api.TallyTotals.get(id)).toEqual({ total: 1, adds: 1, closed: false });
        yield* sql`DROP TRIGGER reject_ack ON ${sql(`${schema}.outbox`)}`;
        expect(yield* api.TallyTotals.get(id, { atLeast: receipt })).toEqual({
          total: 3,
          adds: 2,
          closed: false,
        });
        expect(
          yield* sql`SELECT * FROM ${sql(`${schema}.outbox`)} WHERE failed_at IS NOT NULL`,
        ).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(worldIn(schema)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

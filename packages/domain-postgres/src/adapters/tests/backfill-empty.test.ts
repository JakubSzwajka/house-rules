import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { PgForTests, testSchema } from "../from-env.ts";
import { migrate } from "../tables.ts";
import { world } from "./backfill-fixture.ts";

const completionTransactions = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* Pg.PgClient;
    yield* migrate(schema);
    yield* sql`CREATE TABLE ${sql(`${schema}.completions`)} (target text, tx bigint)`;
    yield* sql.unsafe(`CREATE FUNCTION ${schema}.record_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.complete AND NOT OLD.complete THEN
        INSERT INTO ${schema}.completions VALUES (NEW.target, txid_current());
      END IF;
      RETURN NEW;
    END $$`);
    yield* sql`CREATE TRIGGER record_completion AFTER UPDATE ON ${sql(`${schema}.backfills`)}
    FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.record_completion`)}()`;
  });

describe.skipIf(process.env["DOMAIN_STORE"] === "memory")(
  "empty eager bootstrap transactions",
  () => {
    it.live.each(["empty", "view_keys", "view_entries", "events"] as const)(
      "batches completions only without model history: %s",
      (history) =>
        Effect.gen(function* () {
          const schema = yield* testSchema;
          const sql = yield* Pg.PgClient;
          yield* completionTransactions(schema);
          if (history === "view_keys") {
            yield* sql`INSERT INTO ${sql(`${schema}.view_keys`)} (model, view, key, snapshot)
          VALUES ('Backfilled', 'Retired', 'one', '{}'::jsonb)`;
          } else if (history === "view_entries") {
            yield* sql`INSERT INTO ${sql(`${schema}.view_entries`)} (model, view, key, seq, entry)
          VALUES ('Backfilled', 'Retired', 'one', 1, '{}'::jsonb)`;
          } else if (history === "events") {
            yield* sql`INSERT INTO ${sql(`${schema}.events`)} (model, aggregate, id, seq, event, envelope)
          VALUES ('Backfilled', 'Retired', 'one', 1, '{}'::jsonb, '{}'::jsonb)`;
          }
          const empty = world(schema, 0, []);
          yield* Layer.build(empty.live).pipe(Effect.scoped);
          const completions = yield* sql<{
            tx: bigint;
          }>`SELECT tx FROM ${sql(`${schema}.completions`)}`;
          expect(completions).toHaveLength(3);
          expect(new Set(completions.map((row) => row.tx)).size).toBe(history === "empty" ? 1 : 3);
          const progress = yield* sql<{
            plan: unknown;
            complete: boolean;
            cursor: unknown;
            routed: bigint;
          }>`SELECT plan, complete, cursor, routed FROM ${sql(`${schema}.backfills`)}`;
          expect(
            progress.every(
              (row) =>
                row.plan !== null && row.complete && row.cursor === null && row.routed === 0n,
            ),
          ).toBe(true);
        }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );

    it.live(
      "rolls back an empty batch on a missing downstream plan but retains pending intents",
      () =>
        Effect.gen(function* () {
          const schema = yield* testSchema;
          const sql = yield* Pg.PgClient;
          const broken = world(schema, 0, [], undefined, undefined, {
            host: (host) => ({
              ...host,
              start: (targets, planOf, eager) =>
                host.start?.(
                  targets,
                  (target) => (target === "view:Mirrored" ? undefined : planOf(target)),
                  eager,
                ) ?? Effect.die("start missing"),
            }),
          });
          expect(
            Exit.isFailure(yield* Layer.build(broken.live).pipe(Effect.scoped, Effect.exit)),
          ).toBe(true);
          expect(
            yield* sql`SELECT complete, plan, cursor, routed FROM ${sql(`${schema}.backfills`)} ORDER BY target`,
          ).toEqual([
            { complete: false, plan: null, cursor: null, routed: 0n },
            { complete: false, plan: null, cursor: null, routed: 0n },
            { complete: false, plan: null, cursor: null, routed: 0n },
          ]);
          const resumed = world(schema, 0, []);
          yield* Layer.build(resumed.live).pipe(Effect.scoped);
          expect(yield* sql`SELECT complete FROM ${sql(`${schema}.backfills`)}`).toEqual([
            { complete: true },
            { complete: true },
            { complete: true },
          ]);
        }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );
  },
);

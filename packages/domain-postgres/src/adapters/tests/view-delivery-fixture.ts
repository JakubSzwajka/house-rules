import {
  type Delivery,
  Platform,
  type ViewKit,
  type ViewStore,
} from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { layer } from "../postgres-platform.ts";
import { migrate } from "../tables.ts";
import { TalliesLive } from "./tally.ts";
export const onPostgres = process.env["DOMAIN_STORE"] !== "memory";
export const until = <A, E, R>(effect: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  effect.pipe(
    Effect.repeat({ until: done, schedule: Schedule.spaced("20 millis") }),
    Effect.timeout("5 seconds"),
  );
export const worldIn = (
  schema: string,
  inspect: (kit: ViewKit) => ViewKit = (kit) => kit,
  stores = new Map<string, ViewStore>(),
) =>
  TalliesLive.pipe(
    Layer.provideMerge(
      Layer.effect(
        Platform,
        Effect.map(Platform, (platform) =>
          Platform.of({
            model: (model) =>
              Effect.map(platform.model(model), (host) => ({
                ...host,
                view: (view, kit) =>
                  host
                    .view(view, inspect(kit))
                    .pipe(Effect.tap((store) => Effect.sync(() => stores.set(kit.name, store)))),
              })),
          }),
        ),
      ).pipe(Layer.provide(layer({ schema, pollInterval: "20 millis", maxAttempts: 2 }))),
    ),
  );

export interface Record {
  readonly kind: string;
  readonly transaction: string;
  readonly delivery: Delivery | null;
}

export const recordTransactions = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* Pg.PgClient;
    yield* migrate(schema);
    yield* sql`CREATE TABLE ${sql(`${schema}.transactions`)} (kind text, transaction text, delivery jsonb)`;
    yield* sql.unsafe(`
      CREATE FUNCTION ${schema}.record_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'view_keys' THEN
          IF NEW.view = 'TallyTotals' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
            INSERT INTO ${schema}.transactions VALUES ('view', txid_current()::text, NULL);
          END IF;
        ELSE
          IF OLD.delivery->'target'->>'name' = 'TallyTotals' THEN
            INSERT INTO ${schema}.transactions VALUES ('ack', txid_current()::text, OLD.delivery);
          END IF;
        END IF;
        RETURN NULL;
      END $$`);
    yield* sql`CREATE TRIGGER record_view AFTER UPDATE ON ${sql(`${schema}.view_keys`)}
      FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.record_transaction`)}()`;
    yield* sql`CREATE TRIGGER record_ack AFTER DELETE ON ${sql(`${schema}.outbox`)}
      FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.record_transaction`)}()`;
  });

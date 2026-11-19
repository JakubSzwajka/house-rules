import {
  type Delivery,
  emptySnapshot,
  type StoredEvent,
  type ViewEntry,
  type ViewKit,
  type ViewSnapshot,
  type ViewStore,
} from "@alchemy.run/domain/Platform";
import * as Effect from "effect/Effect";
import type { SqlError } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import { AcknowledgeViewDelivery, type Host } from "./host.ts";

export const makeViewStore = (host: Host, kit: ViewKit) =>
  Effect.gen(function* () {
    const { sql, t, model, notify, kick, stage } = host;
    const name = kit.name;
    const where = (key: string) => sql`model = ${model} AND view = ${name} AND key = ${key}`;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ generation: number; catch_up: boolean | null }>`
            SELECT generation, catch_up FROM ${t("views")}
            WHERE model = ${model} AND view = ${name} FOR UPDATE`;
          const stored = rows[0];
          const catchUp = kit.catchUp !== undefined;
          if (stored !== undefined && stored.generation >= kit.generation) {
            if (stored.generation > kit.generation) return;
            if (!catchUp) {
              if (stored.catch_up === true) {
                yield* sql`INSERT INTO ${t("backfills")} (model, target, plan)
                  VALUES (${model}, ${kit.target}, 'null'::jsonb)
                  ON CONFLICT (model, target) DO UPDATE SET complete = false, cursor = NULL,
                    routed = 0, applied = 0, deduped = 0`;
              } else {
                yield* sql`INSERT INTO ${t("backfills")} (model, target, plan, complete)
                  VALUES (${model}, ${kit.target}, 'null'::jsonb, true) ON CONFLICT DO NOTHING`;
              }
            }
            yield* sql`UPDATE ${t("views")} SET catch_up = ${catchUp}
              WHERE model = ${model} AND view = ${name}`;
            return;
          }
          yield* sql`DELETE FROM ${t("view_keys")} WHERE model = ${model} AND view = ${name}`;
          yield* sql`DELETE FROM ${t("view_entries")} WHERE model = ${model} AND view = ${name}`;
          yield* sql`
            INSERT INTO ${t("views")} (model, view, generation, catch_up)
            VALUES (${model}, ${name}, ${kit.generation}, ${catchUp})
            ON CONFLICT (model, view) DO UPDATE
              SET generation = EXCLUDED.generation, catch_up = EXCLUDED.catch_up`;
          if (!catchUp) {
            yield* sql`INSERT INTO ${t("backfills")} (model, target, plan)
              VALUES (${model}, ${kit.target}, 'null'::jsonb) ON CONFLICT DO NOTHING`;
          }
        }),
      )
      .pipe(Effect.orDie);
    const publish = (key: string, changed: boolean) =>
      changed ? Effect.andThen(notify.bump(`v:${name}/${key}`), kick) : Effect.void;
    const isFilled = (key: string) =>
      sql<{ filled_generation: number | null }>`SELECT filled_generation
        FROM ${t("view_keys")} WHERE ${where(key)}`.pipe(
        Effect.map((keys) => keys[0]?.filled_generation === kit.generation),
      );
    const readReady = <A>(key: string, query: Effect.Effect<A, SqlError>) =>
      Effect.gen(function* () {
        if (!kit.catchUp || (yield* isFilled(key))) return yield* query;
        const result = yield* sql.withTransaction(
          Effect.gen(function* () {
            const changed = yield* ready(key).pipe(
              Effect.provideService(AcknowledgeViewDelivery, Effect.void),
            );
            return { value: yield* query, changed };
          }),
        );
        yield* publish(key, result.changed);
        return result.value;
      }).pipe(Effect.orDie);
    const read = (key: string) =>
      readReady(
        key,
        sql<{ snapshot: ViewSnapshot }>`SELECT snapshot
          FROM ${t("view_keys")} WHERE ${where(key)}`.pipe(
          Effect.map((rows) => rows[0]?.snapshot ?? emptySnapshot),
        ),
      );
    const entriesAfter = (key: string, after: number) =>
      readReady(
        key,
        sql<{ entry: ViewEntry }>`SELECT entry
          FROM ${t("view_entries")} WHERE ${where(key)} AND seq > ${after} ORDER BY seq`.pipe(
          Effect.map((rows) => rows.map((row) => row.entry)),
        ),
      );
    const apply = (key: string, deliveries: ReadonlyArray<Delivery>) =>
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO ${t("view_keys")} (model, view, key, snapshot)
          VALUES (${model}, ${name}, ${key}, ${sql.json(emptySnapshot)}) ON CONFLICT DO NOTHING`;
        const rows = yield* sql<{ snapshot: ViewSnapshot }>`
          SELECT snapshot FROM ${t("view_keys")} WHERE ${where(key)} FOR UPDATE`;
        const before = rows[0]?.snapshot ?? emptySnapshot;
        const result = yield* kit.apply(key, before, deliveries);
        if (!result.changed) return false;
        yield* sql`UPDATE ${t("view_keys")} SET snapshot = ${sql.json(result.snapshot)} WHERE ${where(key)}`;
        yield* Effect.forEach(
          result.entries,
          (entry) => sql`
            INSERT INTO ${t("view_entries")} (model, view, key, seq, entry)
            VALUES (${model}, ${name}, ${key}, ${entry.seq}, ${sql.json(entry)})`,
          { discard: true },
        );
        yield* stage(result.downstream);
        return true;
      });
    const ready = (key: string, incoming: ReadonlyArray<Delivery> = []) =>
      Effect.gen(function* () {
        const source = kit.catchUp?.source;
        if (source === undefined || (yield* isFilled(key))) return false;
        const events = yield* sql<StoredEvent>`SELECT event, envelope FROM ${t("events")}
          WHERE model = ${model} AND aggregate = ${source} AND id = ${key} ORDER BY seq`;
        if (events.length === 0) return false;
        yield* sql`INSERT INTO ${t("view_keys")} (model, view, key, snapshot)
          VALUES (${model}, ${name}, ${key}, ${sql.json(emptySnapshot)}) ON CONFLICT DO NOTHING`;
        const keys = yield* sql<{ filled_generation: number | null }>`SELECT filled_generation
          FROM ${t("view_keys")} WHERE ${where(key)} FOR UPDATE`;
        if (keys[0]?.filled_generation === kit.generation) return false;
        const pending = yield* sql<{ delivery: Delivery }>`SELECT delivery FROM ${t("outbox")}
          WHERE model = ${model} AND delivery->'target'->>'kind' = 'view'
            AND delivery->'target'->>'name' = ${name} AND delivery->>'key' = ${key}
            AND delivery->>'source' = ${`${source}/${key}`}
            AND COALESCE((delivery->'target'->>'generation')::int, 0) = ${kit.generation}
            AND COALESCE((delivery->>'history')::boolean, false) = false ORDER BY position`;
        const live = new Map<number, Delivery>();
        for (const delivery of [...pending.map((row) => row.delivery), ...incoming]) {
          if (
            !delivery.history &&
            delivery.source === `${source}/${key}` &&
            delivery.target.name === name &&
            delivery.key === key &&
            (delivery.target.generation ?? 0) === kit.generation
          )
            live.set(delivery.seq, delivery);
        }
        const history = yield* kit.history(kit.target, source, key, events);
        let changed = false;
        for (const row of history) {
          for (const delivery of row.deliveries) {
            const applied = yield* apply(delivery.key, [live.get(delivery.seq) ?? delivery]);
            changed = changed || applied;
          }
        }
        yield* sql`UPDATE ${t("view_keys")} SET filled_generation = ${kit.generation}
          WHERE ${where(key)}`;
        return changed;
      });
    const store: ViewStore = {
      receive: (key, deliveries) =>
        Effect.suspend(() => {
          const delivery = deliveries.length === 1 ? deliveries[0] : undefined;
          const acknowledge = delivery ? host.acknowledgements.get(delivery) : undefined;
          if (delivery) host.acknowledgements.delete(delivery);
          return sql
            .withTransaction(
              Effect.gen(function* () {
                const filled = yield* ready(key, deliveries).pipe(
                  Effect.provideService(AcknowledgeViewDelivery, Effect.void),
                );
                // Apply cannot pass this row's acknowledgement to nested receives or child fibers.
                const changed = yield* apply(key, deliveries).pipe(
                  Effect.provideService(AcknowledgeViewDelivery, Effect.void),
                );
                yield* yield* AcknowledgeViewDelivery;
                return filled || changed;
              }),
            )
            .pipe(Effect.provideService(AcknowledgeViewDelivery, acknowledge ?? Effect.void));
        }).pipe(
          Effect.orDie,
          Effect.tap((changed) => publish(key, changed)),
          Effect.asVoid,
          kit.observe(key, deliveries),
        ),
      read,
      changes: (key) => notify.changes(`v:${name}/${key}`, read(key)),
      list: (key) => entriesAfter(key, 0),
      tail: (key, after) => {
        let last = after;
        return notify.changes(`v:${name}/${key}`, Effect.void).pipe(
          Stream.flatMap(() =>
            Stream.unwrap(
              Effect.map(entriesAfter(key, last), (fresh) => {
                const newest = fresh.at(-1);
                if (newest) last = newest.seq;
                return Stream.fromIterable(fresh);
              }),
            ),
          ),
        );
      },
    };
    return store;
  });

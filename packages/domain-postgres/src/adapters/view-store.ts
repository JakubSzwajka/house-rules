import {
  type Delivery,
  emptySnapshot,
  type ViewEntry,
  type ViewKit,
  type ViewSnapshot,
  type ViewStore,
} from "@alchemy.run/domain/Platform";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Host } from "./host.ts";

export const makeViewStore = (host: Host, kit: ViewKit) =>
  Effect.gen(function* () {
    const { sql, t, model, notify, kick, stage } = host;
    const name = kit.name;
    const where = (key: string) => sql`model = ${model} AND view = ${name} AND key = ${key}`;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ generation: number }>`
            SELECT generation FROM ${t("views")} WHERE model = ${model} AND view = ${name} FOR UPDATE`;
          const stored = rows[0]?.generation;
          if (stored !== undefined && stored >= kit.generation) return;
          // Rebuilt: start every key over. Without a backfill, keys refill from new events only.
          yield* sql`DELETE FROM ${t("view_keys")} WHERE model = ${model} AND view = ${name}`;
          yield* sql`DELETE FROM ${t("view_entries")} WHERE model = ${model} AND view = ${name}`;
          yield* sql`
            INSERT INTO ${t("views")} (model, view, generation) VALUES (${model}, ${name}, ${kit.generation})
            ON CONFLICT (model, view) DO UPDATE SET generation = EXCLUDED.generation`;
        }),
      )
      .pipe(Effect.orDie);
    const read = (key: string) =>
      Effect.map(
        sql<{
          snapshot: ViewSnapshot;
        }>`SELECT snapshot FROM ${t("view_keys")} WHERE ${where(key)}`,
        (rows) => rows[0]?.snapshot ?? emptySnapshot,
      ).pipe(Effect.orDie);
    const entriesAfter = (key: string, after: number) =>
      Effect.map(
        sql<{ entry: ViewEntry }>`
          SELECT entry FROM ${t("view_entries")} WHERE ${where(key)} AND seq > ${after} ORDER BY seq`,
        (rows) => rows.map((row) => row.entry),
      ).pipe(Effect.orDie);
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
    const store: ViewStore = {
      receive: (key, deliveries) =>
        sql.withTransaction(apply(key, deliveries)).pipe(
          Effect.orDie,
          Effect.tap((changed) =>
            changed ? Effect.andThen(notify.bump(`v:${name}/${key}`), kick) : Effect.void,
          ),
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

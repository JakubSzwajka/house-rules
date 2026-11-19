import { PlanChanged, type Plan, planChanged, samePlan } from "@alchemy.run/domain/Backfill";
import type { StoredEvent, ViewKit, ViewSnapshot, ViewStore } from "@alchemy.run/domain/Platform";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Host } from "./host.ts";

interface Cursor {
  readonly source: string;
  readonly id: string;
  readonly seq: number;
}
interface Progress {
  readonly plan: Plan | null;
  readonly cursor: Cursor | null;
  readonly complete: boolean;
  readonly routed: string;
  readonly applied: string;
  readonly deduped: string;
}
interface Row extends Cursor {
  readonly row: unknown;
}
export interface ReplayView {
  readonly kit: ViewKit;
  readonly store: ViewStore;
}

class BackfillIncomplete extends Data.TaggedError("BackfillIncomplete")<{
  readonly target: string;
}> {}

export const makeBackfill = (host: Host, views: Map<string, ReplayView>) => {
  const { sql, t, model } = host;
  const replay = (view: ReplayView, plan: Plan) =>
    Effect.gen(function* () {
      const target = view.kit.target;
      yield* sql`INSERT INTO ${t("backfills")} (model, target, plan)
        VALUES (${model}, ${target}, ${sql.json(plan)}) ON CONFLICT DO NOTHING`;
      let complete = false;
      while (!complete) {
        complete = yield* sql.withTransaction(
          Effect.gen(function* () {
            const progress =
              yield* sql<Progress>`SELECT plan, cursor, complete, routed, applied, deduped FROM ${t("backfills")}
              WHERE model = ${model} AND target = ${target} FOR UPDATE`;
            const current = progress[0];
            if (!current) return false;
            if (current.plan === null) {
              yield* sql`UPDATE ${t("backfills")} SET plan = ${sql.json(plan)}
                WHERE model = ${model} AND target = ${target}`;
            } else if (!samePlan(current.plan, plan)) {
              return yield* Effect.die(
                new PlanChanged({ message: planChanged(target, current.plan, plan) }),
              );
            }
            if (current.complete) return true;
            const cursor = current.cursor;
            const rows = yield* sql<Row>`
              SELECT source, id, seq, row FROM (
                SELECT aggregate AS source, id, seq,
                  jsonb_build_object('event', event, 'envelope', envelope) AS row
                FROM ${t("events")} WHERE model = ${model}
                UNION ALL
                SELECT view AS source, key AS id, seq, entry AS row
                FROM ${t("view_entries")} WHERE model = ${model}
              ) history
              WHERE ${sql.in("source", plan.sources ?? [])}
                AND (${cursor === null} OR
                  (source COLLATE "C", id COLLATE "C", seq) >
                  (${cursor?.source ?? ""}, ${cursor?.id ?? ""}, ${cursor?.seq ?? 0}))
              ORDER BY source COLLATE "C", id COLLATE "C", seq LIMIT 128`;
            if (rows.length === 0) {
              const keys = yield* sql<{
                count: string;
              }>`SELECT count(*) AS count FROM ${t("view_keys")}
                WHERE model = ${model} AND view = ${view.kit.name}`;
              if (
                BigInt(current.routed) !== BigInt(current.applied) + BigInt(current.deduped) ||
                (BigInt(current.routed) > 0n && Number(keys[0]?.count) === 0)
              ) {
                return yield* Effect.die(new BackfillIncomplete({ target }));
              }
              yield* sql`UPDATE ${t("backfills")} SET complete = true
                WHERE model = ${model} AND target = ${target}`;
              return true;
            }
            let routedCount = 0;
            let appliedCount = 0;
            let dedupedCount = 0;
            let start = 0;
            while (start < rows.length) {
              const first = rows[start];
              if (!first) break;
              let end = start + 1;
              while (
                end < rows.length &&
                rows[end]?.source === first.source &&
                rows[end]?.id === first.id
              )
                end++;
              const routed = yield* view.kit.history(
                target,
                first.source,
                first.id,
                rows.slice(start, end).map((row) => row.row),
              );
              for (const row of routed) {
                for (const delivery of row.deliveries) {
                  const before = yield* sql<{
                    snapshot: ViewSnapshot;
                  }>`SELECT snapshot FROM ${t("view_keys")}
                    WHERE model = ${model} AND view = ${view.kit.name} AND key = ${delivery.key}`;
                  const duplicate =
                    (before[0]?.snapshot.checkpoints[delivery.source] ?? 0) >= delivery.seq;
                  const pending = yield* sql<{ delivery: typeof delivery }>`SELECT delivery
                    FROM ${t("outbox")} WHERE model = ${model}
                      AND delivery->'target'->>'kind' = 'view'
                      AND delivery->'target'->>'name' = ${view.kit.name}
                      AND delivery->>'key' = ${delivery.key} AND delivery->>'source' = ${delivery.source}
                      AND (delivery->>'seq')::int = ${delivery.seq}
                      AND COALESCE((delivery->'target'->>'generation')::int, 0) = ${view.kit.generation}
                      AND COALESCE((delivery->>'history')::boolean, false) = false ORDER BY position LIMIT 1`;
                  yield* view.store.receive(delivery.key, [pending[0]?.delivery ?? delivery]);
                  const after = yield* sql<{
                    snapshot: ViewSnapshot;
                  }>`SELECT snapshot FROM ${t("view_keys")}
                    WHERE model = ${model} AND view = ${view.kit.name} AND key = ${delivery.key}`;
                  if ((after[0]?.snapshot.checkpoints[delivery.source] ?? 0) < delivery.seq) {
                    return yield* Effect.die(new BackfillIncomplete({ target }));
                  }
                  routedCount++;
                  if (duplicate) dedupedCount++;
                  else appliedCount++;
                }
              }
              start = end;
            }
            const last = rows.at(-1);
            if (last) {
              yield* sql`UPDATE ${t("backfills")} SET cursor = ${sql.json({ source: last.source, id: last.id, seq: last.seq })},
                  routed = routed + ${routedCount}, applied = applied + ${appliedCount}, deduped = deduped + ${dedupedCount}
                WHERE model = ${model} AND target = ${target}`;
            }
            return false;
          }),
        );
      }
    }).pipe(Effect.orDie);
  const start = (targets: ReadonlyArray<string>, planOf: (target: string) => Plan | undefined) =>
    Effect.gen(function* () {
      const done = new Set<string>();
      const visiting = new Set<string>();
      const visit = (view: ReplayView): Effect.Effect<void> =>
        Effect.gen(function* () {
          const target = view.kit.target;
          if (done.has(target)) return;
          if (visiting.has(target)) {
            return yield* Effect.die(
              new PlanChanged({ message: `cyclic view source at ${target}` }),
            );
          }
          visiting.add(target);
          if (view.kit.catchUp) {
            const keys = yield* sql<{ id: string }>`SELECT DISTINCT id FROM ${t("events")}
                WHERE model = ${model} AND aggregate = ${view.kit.catchUp.source} ORDER BY id`;
            for (const key of keys) yield* view.store.read(key.id);
            visiting.delete(target);
            done.add(target);
            return;
          }
          const plan = planOf(target);
          if (!plan?.sources) {
            return yield* Effect.die(
              new PlanChanged({ message: `missing source plan for ${target}` }),
            );
          }
          for (const source of plan.sources) {
            const upstream = views.get(source);
            if (upstream) yield* visit(upstream);
          }
          yield* replay(view, plan);
          visiting.delete(target);
          done.add(target);
        }).pipe(Effect.orDie);
      for (const view of views.values()) {
        if (targets.includes(view.kit.target)) yield* visit(view);
      }
    });
  return {
    start: (targets: ReadonlyArray<string>, planOf: (target: string) => Plan | undefined) =>
      Effect.gen(function* () {
        if (![...views.values()].some((view) => targets.includes(view.kit.target))) return;
        const rows = yield* sql<{ empty: boolean }>`SELECT
          NOT EXISTS (SELECT 1 FROM ${t("events")} WHERE model = ${model})
          AND NOT EXISTS (SELECT 1 FROM ${t("view_entries")} WHERE model = ${model})
          AND NOT EXISTS (SELECT 1 FROM ${t("view_keys")} WHERE model = ${model})
          AND NOT EXISTS (SELECT 1 FROM ${t("backfills")} WHERE model = ${model}
            AND (complete OR cursor IS NOT NULL OR plan <> 'null'::jsonb
              OR routed <> 0 OR applied <> 0 OR deduped <> 0)) AS empty`;
        const run = start(targets, planOf);
        yield* rows[0]?.empty ? sql.withTransaction(run) : run;
      }).pipe(Effect.orDie),
    history: (target: string) =>
      Effect.gen(function* () {
        const view = [...views.values()].find((view) => view.kit.target === target);
        const source = view?.kit.catchUp?.source;
        if (source !== undefined && view) {
          const keys = yield* sql<{ id: string }>`SELECT DISTINCT id FROM ${t("events")}
            WHERE model = ${model} AND aggregate = ${source}`;
          for (const key of keys) {
            const snapshots = yield* sql<{
              snapshot: ViewSnapshot;
              filled_generation: number | null;
            }>`
              SELECT snapshot, filled_generation FROM ${t("view_keys")}
              WHERE model = ${model} AND view = ${view.kit.name} AND key = ${key.id}`;
            const found = snapshots[0];
            if (found?.filled_generation !== view.kit.generation) return { complete: false };
            const checkpoint = found.snapshot.checkpoints[`${source}/${key.id}`] ?? 0;
            const events = yield* sql<StoredEvent>`SELECT event, envelope FROM ${t("events")}
              WHERE model = ${model} AND aggregate = ${source} AND id = ${key.id}
                AND seq > ${checkpoint} ORDER BY seq`;
            const routed = yield* view.kit.history(target, source, key.id, events);
            if (routed.some((row) => row.deliveries.length > 0)) return { complete: false };
          }
          return { complete: true };
        }
        const rows = yield* sql<{ complete: boolean }>`SELECT complete FROM ${t("backfills")}
          WHERE model = ${model} AND target = ${target}`;
        return { complete: rows[0]?.complete === true };
      }).pipe(Effect.orDie),
  };
};

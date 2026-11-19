import type { Delivery } from "@alchemy.run/domain/Platform";
import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import { isSqlError, type SqlError } from "effect/sql/SqlError";
import type { Monitor, Snapshot } from "./outbox-status.ts";

const BATCH = 100;

interface Row {
  readonly position: string;
  readonly delivery: Delivery;
  readonly attempts: number;
}

type Pass = "drained" | "more" | "retry";

export const makeOutbox = (options: {
  readonly sql: PgClient;
  readonly table: string;
  readonly model: string;
  readonly wake: Queue.Queue<void>;
  readonly deliver: (
    delivery: Delivery,
    acknowledge: Effect.Effect<void, SqlError>,
  ) => Effect.Effect<void, SqlError>;
  readonly pollInterval: Duration.Input;
  readonly maxAttempts: number;
  readonly outboxStatus?: (model: string, monitor: Monitor) => void;
}) => {
  const { sql, model } = options;
  const table = sql(options.table);
  let status: Omit<Snapshot, "oldestPendingAgeMillis"> = {
    alive: false,
    available: false,
    lastSuccessfulPass: null,
    observedAt: null,
    pendingCount: null,
    parkedCount: null,
  };
  let oldestAt: number | null = null;
  const monitor: Monitor = {
    snapshot: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return {
        ...status,
        oldestPendingAgeMillis:
          status.available && oldestAt !== null ? Math.max(0, now - oldestAt) : null,
      };
    }),
  };
  const pass: Effect.Effect<Pass, SqlError> = Effect.gen(function* () {
    const rows = yield* sql<Row>`
      SELECT pending.position, pending.delivery, pending.attempts FROM ${table} pending
      WHERE pending.model = ${model} AND pending.failed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${table} parked
          WHERE parked.model = pending.model AND parked.failed_at IS NOT NULL
            AND parked.position < pending.position
            AND pending.delivery->'target'->>'kind' = 'view'
            AND parked.delivery->'target'->>'kind' = 'view'
            AND parked.delivery->'target'->>'name' = pending.delivery->'target'->>'name'
            AND COALESCE(parked.delivery->'target'->>'generation', '0') =
              COALESCE(pending.delivery->'target'->>'generation', '0')
            AND COALESCE(parked.delivery->'target'->>'inPlace', 'false') =
              COALESCE(pending.delivery->'target'->>'inPlace', 'false')
            AND parked.delivery->>'key' = pending.delivery->>'key'
        )
      ORDER BY pending.position LIMIT ${BATCH}`;
    const blocked = new Set<string>();
    for (const row of rows) {
      const { target } = row.delivery;
      const partition = JSON.stringify([
        target.kind,
        target.name,
        target.generation ?? 0,
        target.inPlace ?? false,
        row.delivery.key,
      ]);
      if (blocked.has(partition)) continue;
      const acknowledge = sql`DELETE FROM ${table} WHERE position = ${row.position}`.pipe(
        Effect.asVoid,
      );
      const isView = row.delivery.target.kind === "view";
      const handler = yield* Effect.forkChild(options.deliver(row.delivery, acknowledge));
      const exit = yield* Fiber.await(handler);
      if (Exit.isSuccess(exit)) {
        if (!isView) yield* acknowledge;
        continue;
      }
      if (
        exit.cause.reasons.some((reason) =>
          Cause.isDieReason(reason)
            ? isSqlError(reason.defect)
            : Cause.isFailReason(reason) && isSqlError(reason.error),
        )
      ) {
        return yield* Effect.failCause(
          Cause.fromReasons(
            exit.cause.reasons.filter((reason) => !Cause.isInterruptReason(reason)),
          ),
        );
      }
      const attempts = row.attempts + 1;
      if (attempts >= options.maxAttempts) {
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE ${table} SET attempts = ${attempts}, failed_at = ${now} WHERE position = ${row.position}`;
        yield* Effect.logError(
          `delivery ${row.position} to ${row.delivery.target.kind} ${row.delivery.target.name} failed ${attempts} times; parked`,
          exit.cause,
        );
        if (isView) blocked.add(partition);
        continue;
      }
      yield* sql`UPDATE ${table} SET attempts = ${attempts} WHERE position = ${row.position}`;
      yield* Effect.logWarning(
        `delivery ${row.position} to ${row.delivery.target.kind} ${row.delivery.target.name} failed; retrying`,
        exit.cause,
      );
      // Stop here so later deliveries from the same source never overtake this one.
      return "retry";
    }
    return rows.length === BATCH ? "more" : "drained";
  });
  const observe = Effect.gen(function* () {
    const rows = yield* sql<{ pending: number; parked: number; oldest: number | null }>`
      SELECT count(*) FILTER (WHERE failed_at IS NULL)::int AS pending,
        count(*) FILTER (WHERE failed_at IS NOT NULL)::int AS parked,
        min((delivery->'envelope'->>'at')::double precision)
          FILTER (WHERE failed_at IS NULL) AS oldest
      FROM ${table} WHERE model = ${model}`;
    const now = yield* Clock.currentTimeMillis;
    oldestAt = rows[0]?.oldest ?? null;
    status = {
      ...status,
      available: true,
      lastSuccessfulPass: now,
      observedAt: now,
      pendingCount: rows[0]?.pending ?? 0,
      parkedCount: rows[0]?.parked ?? 0,
    };
  });

  const backoff = Effect.fnUntraced(function* (failures: number) {
    const jitter = yield* Random.nextBetween(0.5, 1);
    const delay = Math.min(30_000, 100 * 2 ** Math.min(failures, 9)) * jitter;
    yield* Effect.logWarning(`outbox ${model} retrying in ${delay}ms`);
    yield* Effect.sleep(delay);
  });

  const idle = Effect.raceFirst(
    Queue.take(options.wake),
    Effect.sleep(Duration.fromInputUnsafe(options.pollInterval)),
  );

  return Effect.gen(function* () {
    status = { ...status, alive: true };
    yield* Effect.sync(() => options.outboxStatus?.(model, monitor)).pipe(
      Effect.catchCause((cause) =>
        Effect.logError(`outbox ${model} status callback failed`, cause),
      ),
    );
    let failures = 0;
    while (true) {
      const exit = yield* Effect.exit(
        pass.pipe(Effect.tap(() => (options.outboxStatus ? observe : Effect.void))),
      );
      if (Exit.isFailure(exit)) {
        if (Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause);
        status = { ...status, available: false, pendingCount: null, parkedCount: null };
        yield* Effect.logWarning(`outbox ${model} pass failed`, exit.cause);
        yield* backoff(failures++);
        continue;
      }
      if (exit.value === "retry") {
        yield* backoff(failures++);
        continue;
      }
      failures = 0;
      if (exit.value === "more") continue;
      yield* idle;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        status = {
          ...status,
          alive: false,
          available: false,
          pendingCount: null,
          parkedCount: null,
        };
      }),
    ),
    Effect.orDie,
  );
};

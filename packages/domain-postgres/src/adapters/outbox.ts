import type { Delivery } from "@alchemy.run/domain/Platform";
import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";

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
  readonly deliver: (delivery: Delivery) => Effect.Effect<void>;
  readonly pollInterval: Duration.Input;
  readonly maxAttempts: number;
}) => {
  const { sql, model } = options;
  const table = sql(options.table);
  const pass: Effect.Effect<Pass> = Effect.gen(function* () {
    const rows = yield* sql<Row>`
      SELECT position, delivery, attempts FROM ${table}
      WHERE model = ${model} AND failed_at IS NULL
      ORDER BY position LIMIT ${BATCH}`;
    for (const row of rows) {
      const exit = yield* Effect.exit(options.deliver(row.delivery));
      if (Exit.isSuccess(exit)) {
        yield* sql`DELETE FROM ${table} WHERE position = ${row.position}`;
        continue;
      }
      const attempts = row.attempts + 1;
      if (attempts >= options.maxAttempts) {
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE ${table} SET attempts = ${attempts}, failed_at = ${now} WHERE position = ${row.position}`;
        yield* Effect.logError(
          `delivery ${row.position} to ${row.delivery.target.kind} ${row.delivery.target.name} failed ${attempts} times; parked`,
          exit.cause,
        );
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
  }).pipe(Effect.orDie);

  const idle = Effect.raceFirst(
    Queue.take(options.wake),
    Effect.sleep(Duration.fromInputUnsafe(options.pollInterval)),
  );

  return Effect.gen(function* () {
    while (true) {
      const result = yield* pass;
      if (result === "more") continue;
      yield* idle;
    }
  });
};

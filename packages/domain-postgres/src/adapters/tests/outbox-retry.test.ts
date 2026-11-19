import type { Delivery } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import { PgForTests, testSchema } from "../from-env.ts";
import { makeOutbox } from "../outbox.ts";
import type { Monitor } from "../outbox-status.ts";
import { migrate } from "../tables.ts";
import { onPostgres, until } from "./view-delivery-fixture.ts";

const delivery: Delivery = {
  target: { kind: "policy", name: "Consumer" },
  key: "one",
  source: "Source/one",
  seq: 1,
  origin: "Source",
  tag: "Changed",
  event: { _tag: "Changed" },
  envelope: { id: "one", stream: "Source/one", seq: 1, at: 1, commandId: "one" },
};

describe.skipIf(!onPostgres)("outbox retry accounting", () => {
  for (const failure of ["handler", "database"] as const) {
    it.live(`does not let commit kicks bypass ${failure} backoff`, () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* migrate(schema);
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
          VALUES ('Retry', ${sql.json(delivery)})`;
        const wake = yield* Queue.sliding<void>(1);
        const first = yield* Deferred.make<number>();
        const second = yield* Deferred.make<number>();
        let calls = 0;
        const fiber = yield* makeOutbox({
          sql,
          table: `${schema}.outbox`,
          model: "Retry",
          wake,
          pollInterval: "20 millis",
          maxAttempts: 3,
          deliver: () =>
            Effect.gen(function* () {
              calls += 1;
              const now = yield* Clock.currentTimeMillis;
              if (calls === 1) {
                yield* Deferred.succeed(first, now);
                if (failure === "database")
                  yield* sql.unsafe("DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '53100'; END $$");
                return yield* Effect.die("handler failed");
              }
              yield* Deferred.succeed(second, now);
              return yield* Effect.never;
            }),
        }).pipe(Effect.forkScoped);
        const initial = yield* Deferred.await(first);
        yield* Effect.forEach(Array.from({ length: 100 }), () => Queue.offer(wake, undefined));
        const retried = yield* Deferred.await(second).pipe(Effect.timeout("2 seconds"));
        expect(retried - initial).toBeGreaterThanOrEqual(45);
        yield* Fiber.interrupt(fiber);
        expect(yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}`).toEqual([
          { attempts: failure === "handler" ? 1 : 0, failed_at: null },
        ]);
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );
  }

  for (const code of ["08006", "53100", "53300", "57P01", "57014", "40001", "40P01"]) {
    for (const channel of ["typed", "defect"] as const) {
      it.live(`retries SQLSTATE ${code} in the ${channel} channel without attempts`, () =>
        Effect.gen(function* () {
          const schema = yield* testSchema;
          const sql = yield* Pg.PgClient;
          yield* migrate(schema);
          yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
            VALUES ('Sqlstate', ${sql.json(delivery)})`;
          const wake = yield* Queue.sliding<void>(1);
          const monitors: Array<Monitor> = [];
          const failed = yield* Deferred.make<void>();
          let recovered = false;
          const rejected = sql
            .unsafe(`DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '${code}'; END $$`)
            .pipe(
              Effect.tapError(() => Deferred.succeed(failed, undefined)),
              Effect.asVoid,
            );
          yield* makeOutbox({
            sql,
            table: `${schema}.outbox`,
            model: "Sqlstate",
            wake,
            pollInterval: "20 millis",
            maxAttempts: 1,
            outboxStatus: (_model, monitor) => monitors.push(monitor),
            deliver: () =>
              recovered
                ? Effect.void
                : channel === "typed"
                  ? rejected
                  : rejected.pipe(Effect.orDie),
          }).pipe(Effect.forkScoped);
          yield* Deferred.await(failed).pipe(Effect.timeout("5 seconds"));
          const monitor = monitors[0];
          if (!monitor) return yield* Effect.die("monitor missing");
          yield* until(monitor.snapshot, (status) => status.alive && !status.available);
          expect(yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}`).toEqual([
            { attempts: 0, failed_at: null },
          ]);
          recovered = true;
          yield* until(monitor.snapshot, (status) => status.available && status.pendingCount === 0);
          expect(yield* sql`SELECT * FROM ${sql(`${schema}.outbox`)}`).toEqual([]);
        }).pipe(Effect.scoped, Effect.provide(PgForTests)),
      );
    }
  }
});

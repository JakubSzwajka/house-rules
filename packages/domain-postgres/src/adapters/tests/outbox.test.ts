import type { Delivery } from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import type { SqlError } from "effect/sql/SqlError";
import { PgForTests, testSchema } from "../from-env.ts";
import { makeOutbox } from "../outbox.ts";
import type { Monitor } from "../outbox-status.ts";
import { migrate } from "../tables.ts";
import { onPostgres, until } from "./view-delivery-fixture.ts";

const delivery = (at: number, seq = 1): Delivery => ({
  target: { kind: "policy", name: "Consumer" },
  key: "one",
  source: "Source/one",
  seq,
  origin: "Source",
  tag: "Changed",
  event: { _tag: "Changed" },
  envelope: { id: "one", stream: "Source/one", seq, at, commandId: `command-${seq}` },
});

describe.skipIf(!onPostgres)("resilient outbox worker", () => {
  for (const failure of [
    "read",
    "handler",
    "acknowledge",
    "handler-compound-typed",
    "handler-compound-defect",
  ] as const) {
    it.live(`recovers ${failure} SQL failures without attempts and reports status lifecycle`, () =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* migrate(schema);
        const table = sql(`${schema}.outbox`);
        const wake = yield* Queue.sliding<void>(1);
        const monitors: Array<Monitor> = [];
        let handlerAvailable = !failure.startsWith("handler");
        let delivered = 0;
        const fiber = yield* makeOutbox({
          sql,
          table: `${schema}.outbox`,
          model: "Recovery",
          wake,
          pollInterval: "20 millis",
          maxAttempts: 1,
          outboxStatus: (_model, monitor) => monitors.push(monitor),
          deliver: () =>
            Effect.gen(function* () {
              if (!handlerAvailable) {
                const query = sql`SELECT * FROM ${sql(`${schema}.unavailable`)}`;
                const fault: Effect.Effect<unknown, SqlError> =
                  failure === "handler-compound-typed" ? query : query.pipe(Effect.orDie);
                yield* fault.pipe(
                  Effect.catchCause((cause) =>
                    Effect.failCause(
                      failure.startsWith("handler-compound")
                        ? Cause.combine(cause, Cause.interrupt())
                        : cause,
                    ),
                  ),
                );
              }
              delivered += 1;
            }),
        }).pipe(Effect.forkScoped);
        yield* until(
          Effect.sync(() => monitors.length),
          (length) => length === 1,
        );
        const monitor = monitors[0];
        if (!monitor) return yield* Effect.die("monitor missing");
        const healthy = yield* until(monitor.snapshot, (status) => status.available);
        expect(healthy.alive).toBe(true);
        expect(healthy.pendingCount).toBe(0);
        expect(healthy.parkedCount).toBe(0);
        expect(healthy.oldestPendingAgeMillis).toBeNull();
        expect(healthy.lastSuccessfulPass).not.toBeNull();
        const at = (yield* Clock.currentTimeMillis) - 5_000;
        if (failure === "acknowledge") {
          yield* sql.unsafe(`
            CREATE FUNCTION ${schema}.reject_ack() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'ack unavailable'; END $$`);
          yield* sql`CREATE TRIGGER reject_ack BEFORE DELETE ON ${table}
            FOR EACH ROW EXECUTE FUNCTION ${sql(`${schema}.reject_ack`)}()`;
        }
        if (failure === "read") yield* sql`ALTER TABLE ${table} RENAME TO outbox_offline`;
        const pendingTable = failure === "read" ? sql(`${schema}.outbox_offline`) : table;
        yield* sql`INSERT INTO ${pendingTable} (model, delivery)
          VALUES ('Recovery', ${sql.json(delivery(at))})`;
        yield* Queue.offer(wake, undefined);
        const unavailable = yield* until(monitor.snapshot, (status) => !status.available);
        expect(unavailable.alive).toBe(true);
        expect(unavailable.pendingCount).toBeNull();
        expect(unavailable.parkedCount).toBeNull();
        expect(unavailable.oldestPendingAgeMillis).toBeNull();
        expect(unavailable.lastSuccessfulPass).not.toBeNull();
        expect(unavailable.observedAt).toBe(unavailable.lastSuccessfulPass);
        expect(yield* sql`SELECT attempts, failed_at FROM ${pendingTable}`).toEqual([
          { attempts: 0, failed_at: null },
        ]);
        if (failure === "read") yield* sql`ALTER TABLE ${pendingTable} RENAME TO outbox`;
        if (failure === "acknowledge") yield* sql`DROP TRIGGER reject_ack ON ${table}`;
        handlerAvailable = true;
        const recovered = yield* until(
          monitor.snapshot,
          (status) => status.available && status.pendingCount === 0,
        );
        expect(recovered.lastSuccessfulPass).toBeGreaterThan(healthy.lastSuccessfulPass ?? 0);
        expect(delivered).toBeGreaterThan(0);
        expect(yield* sql`SELECT * FROM ${table}`).toEqual([]);
        yield* Fiber.interrupt(fiber);
        expect(yield* monitor.snapshot).toMatchObject({
          alive: false,
          available: false,
          pendingCount: null,
          parkedCount: null,
          oldestPendingAgeMillis: null,
        });
        expect((yield* monitor.snapshot).lastSuccessfulPass).toBeGreaterThanOrEqual(
          recovered.lastSuccessfulPass ?? 0,
        );
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
    );
  }

  it.live.each(["self", "joined"] as const)(
    "retries and parks a handler %s interruption without stopping later delivery",
    (kind) =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* migrate(schema);
        const table = sql(`${schema}.outbox`);
        yield* sql`INSERT INTO ${table} (model, delivery) VALUES
          (\'SelfInterrupt\', ${sql.json(delivery(1))}),
          (\'SelfInterrupt\', ${sql.json(delivery(1, 2))})`;
        const wake = yield* Queue.sliding<void>(1);
        const monitors: Monitor[] = [];
        const delivered: number[] = [];
        const fiber = yield* makeOutbox({
          sql,
          table: `${schema}.outbox`,
          model: "SelfInterrupt",
          wake,
          pollInterval: "1 hour",
          maxAttempts: 2,
          outboxStatus: (_model, monitor) => monitors.push(monitor),
          deliver: (row) =>
            row.seq === 1
              ? kind === "self"
                ? Effect.interrupt
                : Effect.interrupt.pipe(Effect.forkChild, Effect.flatMap(Fiber.join))
              : Effect.sync(() => {
                  delivered.push(row.seq);
                }),
        }).pipe(Effect.forkScoped);
        yield* until(
          Effect.sync(() => monitors.length),
          (count) => count === 1,
        );
        const monitor = monitors[0];
        if (!monitor) return yield* Effect.die("monitor missing");
        yield* until(monitor.snapshot, (status) => status.alive && status.parkedCount === 1);
        expect(delivered).toEqual([2]);
        expect(yield* sql`SELECT attempts, failed_at IS NOT NULL AS parked FROM ${table}`).toEqual([
          { attempts: 2, parked: true },
        ]);
        expect((yield* monitor.snapshot).pendingCount).toBe(0);
        yield* Fiber.interrupt(fiber);
        expect((yield* monitor.snapshot).alive).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("contains status callback defects and interrupts database backoff", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* migrate(schema);
      const wake = yield* Queue.sliding<void>(1);
      const monitors: Array<Monitor> = [];
      const fiber = yield* makeOutbox({
        sql,
        table: `${schema}.outbox`,
        model: "Callback",
        wake,
        pollInterval: "20 millis",
        maxAttempts: 1,
        outboxStatus: (_model, monitor) => {
          monitors.push(monitor);
          JSON.parse("invalid callback configuration");
        },
        deliver: () => Effect.void,
      }).pipe(Effect.forkScoped);
      yield* until(
        Effect.sync(() => monitors.length),
        (length) => length === 1,
      );
      const monitor = monitors[0];
      if (!monitor) return yield* Effect.die("monitor missing");
      yield* until(monitor.snapshot, (status) => status.available);
      yield* sql`ALTER TABLE ${sql(`${schema}.outbox`)} RENAME TO outbox_offline`;
      const unavailable = yield* until(monitor.snapshot, (status) => !status.available);
      yield* Fiber.interrupt(fiber).pipe(Effect.timeout("1 second"));
      expect(yield* monitor.snapshot).toMatchObject({
        alive: false,
        available: false,
        lastSuccessfulPass: unavailable.lastSuccessfulPass,
      });
      expect(monitors).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("reports pending event age and interrupts a handler without consuming attempts", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const sql = yield* Pg.PgClient;
      yield* migrate(schema);
      const wake = yield* Queue.sliding<void>(1);
      const blocked = yield* Deferred.make<void>();
      const retry = yield* Deferred.make<void>();
      const monitors: Array<Monitor> = [];
      let attempts = 0;
      const workers = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const fiber = yield* makeOutbox({
        sql,
        table: `${schema}.outbox`,
        model: "Interrupted",
        wake,
        pollInterval: "1 hour",
        maxAttempts: 2,
        outboxStatus: (_model, monitor) => monitors.push(monitor),
        deliver: () =>
          Effect.suspend(() =>
            ++attempts === 1
              ? Effect.die("handler unavailable")
              : Deferred.await(retry).pipe(
                  Effect.andThen(Deferred.succeed(blocked, undefined)),
                  Effect.andThen(Effect.never),
                ),
          ),
      }).pipe(Effect.forkIn(workers));
      yield* until(
        Effect.sync(() => monitors.length),
        (length) => length === 1,
      );
      const monitor = monitors[0];
      if (!monitor) return yield* Effect.die("monitor missing");
      yield* until(monitor.snapshot, (status) => status.available);
      const at = (yield* Clock.currentTimeMillis) - 5_000;
      yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
        VALUES ('Interrupted', ${sql.json(delivery(at))})`;
      yield* Queue.offer(wake, undefined);
      const pending = yield* until(monitor.snapshot, (status) => status.pendingCount === 1);
      expect(pending.oldestPendingAgeMillis).toBeGreaterThanOrEqual(5_000);
      yield* Deferred.succeed(retry, undefined);
      yield* Deferred.await(blocked).pipe(Effect.timeout("5 seconds"));
      yield* Scope.close(workers, Exit.void).pipe(Effect.timeout("1 second"));
      expect(yield* sql`SELECT attempts, failed_at FROM ${sql(`${schema}.outbox`)}`).toEqual([
        { attempts: 1, failed_at: null },
      ]);
      expect(yield* monitor.snapshot).toMatchObject({ alive: false, available: false });
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

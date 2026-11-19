import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import { PgForTests, testSchema } from "../from-env.ts";
import { makeOutbox } from "../outbox.ts";
import { migrate } from "../tables.ts";
import { onPostgres, until } from "./view-delivery-fixture.ts";

const delivery = {
  target: { kind: "policy", name: "Consumer" },
  key: "one",
  source: "Source/one",
  seq: 1,
  origin: "Source",
  tag: "Changed",
  event: { _tag: "Changed" },
  envelope: { id: "one", stream: "Source/one", seq: 1, at: 1, commandId: "command" },
};

describe.skipIf(!onPostgres)("optional outbox observation", () => {
  it.live.each([false, true])(
    "executes status observation SQL only with a callback: %s",
    (observed) =>
      Effect.gen(function* () {
        const schema = yield* testSchema;
        const sql = yield* Pg.PgClient;
        yield* migrate(schema);
        const queries: string[] = [];
        const measured = new Proxy(sql, {
          apply: (target, receiver, args) => {
            const statement = Reflect.apply(target, receiver, args);
            if (!Array.isArray(args[0])) return statement;
            const query = args[0].join("?");
            return statement.pipe(Effect.tap(() => Effect.sync(() => queries.push(query))));
          },
        });
        yield* sql`INSERT INTO ${sql(`${schema}.outbox`)} (model, delivery)
        VALUES ('OptionalMonitor', ${sql.json(delivery)})`;
        const wake = yield* Queue.sliding<void>(1);
        const fiber = yield* makeOutbox({
          sql: measured,
          table: `${schema}.outbox`,
          model: "OptionalMonitor",
          wake,
          pollInterval: "10 millis",
          maxAttempts: 1,
          outboxStatus: observed ? () => undefined : undefined,
          deliver: () => Effect.void,
        }).pipe(Effect.forkScoped);
        yield* until(
          Effect.sync(
            () => queries.filter((query) => query.includes("SELECT pending.position")).length,
          ),
          (passes) => passes >= 2,
        );
        yield* Fiber.interrupt(fiber);
        expect(yield* sql`SELECT count(*)::int AS count FROM ${sql(`${schema}.outbox`)}`).toEqual([
          { count: 0 },
        ]);
        const observations = queries.filter((query) => query.includes("count(*) FILTER"));
        if (observed) expect(observations.length).toBeGreaterThan(0);
        else expect(observations).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});

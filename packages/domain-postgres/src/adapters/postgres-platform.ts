import { type Delivery, type ModelHost, Platform } from "@alchemy.run/domain/Platform";
import { PgClient } from "@effect/sql-pg/PgClient";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import { makeAggregateStore } from "./aggregate-store.ts";
import { type Fire, type Host, notifier } from "./host.ts";
import { makeOutbox } from "./outbox.ts";
import { checkTables, migrate } from "./tables.ts";
import { makeViewStore } from "./view-store.ts";

export interface Options {
  readonly schema?: string;
  readonly createTables?: boolean;
  readonly pollInterval?: Duration.Input;
  readonly maxAttempts?: number;
}

const unsupported = (kind: string) =>
  Effect.die(
    new Error(`@house-rules/domain-postgres does not host ${kind} yet; use Domain.InMemory`),
  );

const makeHost = (
  sql: PgClient,
  schema: string,
  model: string,
  scope: Scope.Scope,
  options: Options,
) =>
  Effect.gen(function* () {
    const t = (name: string) => sql(`${schema}.${name}`);
    const notify = notifier();
    let deliver: ((delivery: Delivery) => Effect.Effect<void>) | undefined;
    const wake = yield* Queue.sliding<void>(1);
    const kick = Queue.offer(wake, undefined).pipe(Effect.asVoid);
    const stage = (deliveries: ReadonlyArray<Delivery>) =>
      Effect.forEach(
        deliveries,
        (delivery) =>
          sql`INSERT INTO ${t("outbox")} (model, delivery) VALUES (${model}, ${sql.json(delivery)})`,
        { discard: true },
      );
    const firing = new Map<string, Fire>();

    const arm = (aggregate: string, id: string, commandId: string, token: string, at: number) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fire = firing.get(aggregate);
        if (!fire) return;
        yield* Effect.sleep(Duration.millis(Math.max(0, at - now))).pipe(
          Effect.andThen(fire(id, commandId, token)),
          Effect.catchCause((cause) =>
            Effect.logError(`scheduled ${aggregate}/${id}/${commandId} failed`, cause),
          ),
          Effect.forkIn(scope),
        );
      });

    const host: Host = { sql, t, model, notify, kick, stage, firing, arm };
    const remember = (kit: { readonly deliver: (delivery: Delivery) => Effect.Effect<void> }) => {
      deliver ??= kit.deliver;
    };

    const outbox = makeOutbox({
      sql,
      table: `${schema}.outbox`,
      model,
      wake,
      deliver: (delivery) =>
        deliver ? deliver(delivery) : Effect.die(new Error("no store is hosted yet")),
      pollInterval: options.pollInterval ?? "1 second",
      maxAttempts: options.maxAttempts ?? 5,
    });

    const modelHost: ModelHost = {
      aggregate: (_aggregate, kit) =>
        Effect.sync(() => {
          remember(kit);
          return makeAggregateStore(host, kit);
        }),
      view: (_view, kit) =>
        Effect.andThen(
          Effect.sync(() => remember(kit)),
          makeViewStore(host, kit),
        ),
      policy: (_policy, kit) => Effect.succeed({ receive: (delivery) => kit.run(delivery) }),
      projection: () => unsupported("projections"),
      stream: () => unsupported("streams"),
      start: () =>
        Effect.gen(function* () {
          const due = yield* sql<{
            aggregate: string;
            id: string;
            command_id: string;
            token: string;
            due_at: string;
          }>`
            SELECT aggregate, id, command_id, token, due_at FROM ${t("schedules")} WHERE model = ${model}`.pipe(
            Effect.orDie,
          );
          yield* Effect.forEach(
            due,
            (row) => arm(row.aggregate, row.id, row.command_id, row.token, Number(row.due_at)),
            { discard: true },
          );
          yield* Effect.forkIn(outbox, scope);
        }),
    };
    return modelHost;
  });

export const layer = (options: Options = {}): Layer.Layer<Platform, never, PgClient> =>
  Layer.effect(
    Platform,
    Effect.gen(function* () {
      const sql = yield* PgClient;
      const schema = options.schema ?? "domain";
      yield* (options.createTables === false ? checkTables(schema) : migrate(schema)).pipe(
        Effect.orDie,
      );
      return Platform.of({
        model: ({ modelName }) =>
          Effect.flatMap(Effect.scope, (scope) => makeHost(sql, schema, modelName, scope, options)),
      });
    }),
  );

import {
  AlreadyCancelled,
  AlreadyExecuted,
  type Due,
  NotScheduled,
  type SendMeta,
} from "@alchemy.run/domain/Aggregate";
import type {
  AggregateKit,
  AggregateStore,
  Json,
  SendResult,
  StoredEvent,
} from "@alchemy.run/domain/Platform";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Host } from "./host.ts";

interface Instance {
  readonly state: Json;
  readonly version: number;
}

export const makeAggregateStore = (host: Host, kit: AggregateKit): AggregateStore => {
  const { sql, t, model, notify, kick, stage, firing, arm } = host;
  const name = kit.name;
  const where = (id: string) => sql`model = ${model} AND aggregate = ${name} AND id = ${id}`;
  const lock = (id: string) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO ${t("instances")} (model, aggregate, id, state, version)
        VALUES (${model}, ${name}, ${id}, NULL, 0) ON CONFLICT DO NOTHING`;
      const rows = yield* sql<Instance>`
        SELECT state, version FROM ${t("instances")} WHERE ${where(id)} FOR UPDATE`;
      return rows[0] ?? { state: null, version: 0 };
    });
  const receipt = (id: string, commandId: string) =>
    Effect.map(
      sql<{ result: SendResult }>`
        SELECT result FROM ${t("receipts")} WHERE ${where(id)} AND command_id = ${commandId}`,
      (rows) => rows[0]?.result,
    );
  const commit = (id: string, command: Json, meta: SendMeta) =>
    Effect.gen(function* () {
      const current = yield* lock(id);
      const duplicate = yield* receipt(id, meta.commandId);
      if (duplicate) return duplicate;
      const result = yield* kit.handle({
        id,
        state: current.state,
        version: current.version,
        command,
        commandId: meta.commandId,
        context: meta.context,
        now: yield* Clock.currentTimeMillis,
        correlationId: meta.correlationId,
        trace: meta.trace,
        link: meta.link,
      });
      if (result._tag === "Rejected") return result satisfies SendResult;
      yield* Effect.forEach(
        result.events,
        (stored) => sql`
          INSERT INTO ${t("events")} (model, aggregate, id, seq, event, envelope)
          VALUES (${model}, ${name}, ${id}, ${stored.envelope.seq},
                  ${sql.json(stored.event)}, ${sql.json(stored.envelope)})`,
        { discard: true },
      );
      yield* sql`
        UPDATE ${t("instances")} SET state = ${sql.json(result.state)}, version = ${result.version}
        WHERE ${where(id)}`;
      const sent: SendResult = {
        _tag: "Accepted",
        receipt: {
          stream: `${name}/${id}`,
          version: result.version,
          events: result.events.map((stored) => stored.event),
          reply: result.reply,
        },
      };
      yield* sql`
        INSERT INTO ${t("receipts")} (model, aggregate, id, command_id, result)
        VALUES (${model}, ${name}, ${id}, ${meta.commandId}, ${sql.json(sent)})`;
      yield* stage(result.deliveries);
      return sent;
    });
  const committed = (id: string) => Effect.andThen(notify.bump(`a:${name}/${id}`), kick);
  const send = (id: string, command: Json, meta: SendMeta) =>
    sql.withTransaction(commit(id, command, meta)).pipe(
      Effect.orDie,
      Effect.tap(() => committed(id)),
    );
  firing.set(name, (id, commandId, token) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ command: Json; meta: SendMeta }>`
            DELETE FROM ${t("schedules")}
            WHERE ${where(id)} AND command_id = ${commandId} AND token = ${token}
            RETURNING command, meta`;
          const due = rows[0];
          if (due) yield* commit(id, due.command, due.meta);
        }),
      )
      .pipe(Effect.orDie, Effect.andThen(committed(id))),
  );
  const state = (id: string) =>
    Effect.map(
      sql<Instance>`SELECT state, version FROM ${t("instances")} WHERE ${where(id)}`,
      (rows) => rows[0] ?? { state: null, version: 0 },
    ).pipe(Effect.orDie);
  const eventsAfter = (id: string, after: number) =>
    sql<StoredEvent>`
      SELECT event, envelope FROM ${t("events")} WHERE ${where(id)} AND seq > ${after}
      ORDER BY seq`.pipe(Effect.orDie);
  return {
    send,
    schedule: (id: string, command: Json, meta: SendMeta, due: Due) =>
      Effect.gen(function* () {
        const at = "at" in due ? due.at : (yield* Clock.currentTimeMillis) + due.afterMillis;
        const token = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* lock(id);
              if (yield* receipt(id, meta.commandId))
                return yield* new AlreadyExecuted({
                  aggregate: name,
                  id,
                  commandId: meta.commandId,
                });
              yield* sql`DELETE FROM ${t("cancellations")} WHERE ${where(id)} AND command_id = ${meta.commandId}`;
              const rows = yield* sql<{ token: string }>`
                INSERT INTO ${t("schedules")} (model, aggregate, id, command_id, command, meta, due_at, token)
                VALUES (${model}, ${name}, ${id}, ${meta.commandId}, ${sql.json(command)},
                        ${sql.json(meta)}, ${at}, gen_random_uuid()::text)
                ON CONFLICT (model, aggregate, id, command_id)
                DO UPDATE SET command = EXCLUDED.command, meta = EXCLUDED.meta,
                              due_at = EXCLUDED.due_at, token = EXCLUDED.token
                RETURNING token`;
              const token = rows[0]?.token;
              return token ?? (yield* Effect.die(new Error("schedule row not written")));
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die));
        yield* arm(name, id, meta.commandId, token, at);
        return at;
      }),
    unschedule: (id: string, commandId: string) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const fields = { aggregate: name, id, commandId };
            yield* lock(id);
            if (yield* receipt(id, commandId)) return yield* new AlreadyExecuted(fields);
            const cancelled = yield* sql`
              SELECT 1 FROM ${t("cancellations")} WHERE ${where(id)} AND command_id = ${commandId}`;
            if (cancelled.length > 0) return yield* new AlreadyCancelled(fields);
            const removed = yield* sql`
              DELETE FROM ${t("schedules")} WHERE ${where(id)} AND command_id = ${commandId}
              RETURNING 1`;
            if (removed.length === 0) return yield* new NotScheduled(fields);
            yield* sql`
              INSERT INTO ${t("cancellations")} (model, aggregate, id, command_id)
              VALUES (${model}, ${name}, ${id}, ${commandId})`;
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die)),
    state,
    events: (id: string) => eventsAfter(id, 0),
    changes: (id: string) => notify.changes(`a:${name}/${id}`, state(id)),
    tail: (id: string, after: number) => {
      let last = after;
      return notify.changes(`a:${name}/${id}`, Effect.void).pipe(
        Stream.flatMap(() =>
          Stream.unwrap(
            Effect.map(eventsAfter(id, last), (fresh) => {
              const newest = fresh.at(-1);
              if (newest) last = newest.envelope.seq;
              return Stream.fromIterable(fresh);
            }),
          ),
        ),
      );
    },
  };
};

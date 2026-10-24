import { PgClient } from "@effect/sql-pg/PgClient";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema, Stream } from "effect";
import { Candidate, DeadLetter } from "../../event/delivery.js";
import { EventStoreUnavailable, StoredEvent } from "../../event/event.js";
import { EventStore } from "../../storage.js";

const unavailable = (cause: unknown) => new EventStoreUnavailable({ cause });
export const postgresEventStore = Layer.effect(
  EventStore,
  Effect.gen(function* () {
    const sql = yield* PgClient;
    const columns = sql.literal(
      `id::text as id, kind, json_build_object('kind', subject_kind, 'id', subject_id) as subject, payload, scope_id as "scopeId", actor_id as "actorId", occurred_at::float8 as "occurredAt", request_id as "requestId"`,
    );
    const candidateColumns = sql.literal(
      `row_to_json(e) as event, coalesce(p.attempts, 0) as attempts, coalesce(p.next_due, 0)::float8 as "nextDue", coalesce(p.replay, false) as replay, coalesce(p.generation, '0') as generation, coalesce(p.last_error, 'Delivery failed. See internal logs.') as "lastError"`,
    );
    const deadColumns = sql.literal(
      `consumer, event_id::text as "eventId", last_error as "lastError", attempts, failed_at::float8 as "failedAt"`,
    );
    const read = <A, E>(schema: Schema.Codec<A>, query: Effect.Effect<ReadonlyArray<unknown>, E>) =>
      query.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
        Effect.mapError(unavailable),
      );
    const write = Effect.fn("EventStore.postgres.write")(function* <E>(
      query: Effect.Effect<unknown, E>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    return EventStore.of({
      append: Effect.fn("EventStore.postgres.append")(function* (event) {
        yield* UnitOfWork.required;
        // A sequence alone can commit out of order and let a consumer skip a late commit.
        const ids = yield* read(
          Schema.Struct({ id: Schema.String }),
          sql`update event_log_sequence set cursor = cursor + 1 where singleton = true returning cursor::text as id`,
        );
        const id = ids[0]?.id;
        if (id === undefined) return yield* unavailable("Missing event cursor.");
        yield* write(sql`insert into event_log_events (id, kind, subject_kind, subject_id, payload, scope_id, actor_id, occurred_at, request_id)
        values (${id}::bigint, ${event.kind}, ${event.subject.kind}, ${event.subject.id}, ${sql.json(event.payload)}, ${event.scopeId}, ${event.actorId}, ${event.occurredAt}, ${event.requestId})`);
        yield* write(sql`select pg_notify('house_rules_event_log', '')`);
        return { ...event, id };
      }),
      read: (query) =>
        read(
          StoredEvent,
          sql`select ${columns} from event_log_events where
      id > ${query.after ?? "0"}::bigint
      and (${query.kinds === undefined} or kind in (select jsonb_array_elements_text(${sql.json(query.kinds ?? [])})))
      and (${query.subject === undefined} or (subject_kind = ${query.subject?.kind ?? ""} and subject_id = ${query.subject?.id ?? ""}))
      and (${query.scopeId === undefined} or scope_id = ${query.scopeId ?? ""})
      and (${query.requestId === undefined} or request_id = ${query.requestId ?? ""})
      and (${query.from === undefined} or occurred_at >= ${query.from ?? 0})
      and (${query.to === undefined} or occurred_at <= ${query.to ?? 0})
      order by id limit ${query.limit ?? 100}`,
        ),
      lock: Effect.fn("EventStore.postgres.lock")(function* (consumer) {
        yield* UnitOfWork.required;
        yield* write(
          sql`insert into event_log_consumers (name) values (${consumer}) on conflict (name) do nothing`,
        );
        const rows = yield* read(
          Schema.Struct({ name: Schema.String }),
          sql`select name from event_log_consumers where name = ${consumer} for update skip locked`,
        );
        return rows.length > 0;
      }),
      candidate: Effect.fn("EventStore.postgres.candidate")(function* (consumer, kinds) {
        // Keep replay separate: an OR across pending and history prevents cursor range scans.
        const replays = yield* read(
          Candidate,
          sql`select ${candidateColumns}
        from (select ${columns} from event_log_events where id = (
          select event_id from event_log_pending where consumer = ${consumer} and replay = true
          order by event_id limit 1
        )) e
        join event_log_pending p on p.consumer = ${consumer} and p.event_id = e.id::bigint`,
        );
        if (replays[0] !== undefined) return replays[0];
        const rows = yield* read(
          Candidate,
          sql`select ${candidateColumns}
        from (select ${columns} from event_log_events where id = (
          select next.id from jsonb_array_elements_text(${sql.json(kinds)}) k(kind)
          cross join lateral (
            select id from event_log_events where kind = k.kind
            and id > coalesce((select cursor from event_log_consumers where name = ${consumer}), 0)
            order by id limit 1
          ) next
          order by next.id limit 1
        )) e
        left join event_log_pending p on p.consumer = ${consumer} and p.event_id = e.id::bigint`,
        );
        return rows[0];
      }),
      retry: (consumer, candidate) =>
        write(sql`insert into event_log_pending (consumer, event_id, attempts, next_due, replay, generation, last_error)
      values (${consumer}, ${candidate.event.id}::bigint, ${candidate.attempts}, ${candidate.nextDue}, ${candidate.replay}, ${candidate.generation}, ${candidate.lastError})
      on conflict (consumer, event_id) do update set attempts = excluded.attempts, next_due = excluded.next_due, replay = excluded.replay, generation = excluded.generation, last_error = excluded.last_error`),
      enqueueReplay: Effect.fn("EventStore.postgres.enqueueReplay")(
        function* (consumer, candidate) {
          yield* UnitOfWork.required;
          const rows = yield* read(
            Schema.Struct({ id: Schema.String }),
            sql`insert into event_log_pending (consumer, event_id, attempts, next_due, replay, generation, last_error)
          values (${consumer}, ${candidate.event.id}::bigint, 0, 0, true, ${candidate.generation}, ${candidate.lastError})
          on conflict (consumer, event_id) do nothing returning event_id::text as id`,
          );
          return rows.length > 0;
        },
      ),
      advance: Effect.fn("EventStore.postgres.advance")(function* (consumer, eventId, replay) {
        yield* write(
          sql`delete from event_log_pending where consumer = ${consumer} and event_id = ${eventId}::bigint`,
        );
        if (!replay)
          yield* write(
            sql`update event_log_consumers set cursor = ${eventId}::bigint where name = ${consumer}`,
          );
      }),
      deadLetter: (row) =>
        write(sql`insert into event_log_dead_letters (consumer, event_id, last_error, attempts, failed_at)
      values (${row.consumer}, ${row.eventId}::bigint, ${row.lastError}, ${row.attempts}, ${row.failedAt})
      on conflict (consumer, event_id) do update set last_error = excluded.last_error, attempts = excluded.attempts, failed_at = excluded.failed_at`),
      listDeadLetters: (query) =>
        read(
          DeadLetter,
          sql`select ${deadColumns} from event_log_dead_letters
      where (${query.consumer === undefined} or consumer = ${query.consumer ?? ""}) and (event_id, consumer collate "C") > (${query.after?.eventId ?? "0"}::bigint, ${query.after?.consumer ?? ""})
      order by event_id, consumer collate "C" limit ${query.limit ?? 100}`,
        ),
      findDeadLetter: (consumer, eventId) =>
        read(
          DeadLetter,
          sql`select ${deadColumns} from event_log_dead_letters where consumer = ${consumer} and event_id = ${eventId}::bigint`,
        ).pipe(Effect.map((rows) => rows[0])),
      clearDeadLetter: (consumer, eventId) =>
        write(
          sql`delete from event_log_dead_letters where consumer = ${consumer} and event_id = ${eventId}::bigint`,
        ),
      wakeups: Stream.unwrap(
        sql.listen("house_rules_event_log").pipe(Effect.map(Stream.fromQueue)),
      ).pipe(Stream.as(undefined), Stream.mapError(unavailable)),
    });
  }),
);

import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import {
  DeliveryItem,
  Notification,
  NotificationStoreUnavailable,
  Preference,
  QuietHours,
  TimeZone,
} from "../../notification/notification.js";
import { NotificationStore } from "../../storage.js";
const unavailable = (cause: unknown) => new NotificationStoreUnavailable({ cause });
export const postgresNotificationStore: Layer.Layer<NotificationStore, never, SqlClient> =
  Layer.effect(
    NotificationStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const columns = sql.literal(
        `id, json_build_object('kind', recipient_kind, 'id', recipient_id) as recipient, category, title, body, data, created_at::float8 as "createdAt", read_at::float8 as "readAt"`,
      );
      const deliveryColumns = sql.literal(
        `json_build_object('id', d.id, 'notificationId', d.notification_id, 'recipient', json_build_object('kind', d.recipient_kind, 'id', d.recipient_id), 'channel', d.channel, 'mode', d.mode, 'state', d.state, 'dueAt', d.due_at::float8, 'retryAt', d.retry_at::float8, 'sentAt', d.sent_at::float8, 'attempts', d.attempts, 'lastError', d.last_error) as delivery, json_build_object('id', n.id, 'recipient', json_build_object('kind', n.recipient_kind, 'id', n.recipient_id), 'category', n.category, 'title', n.title, 'body', n.body, 'data', n.data, 'createdAt', n.created_at::float8, 'readAt', n.read_at::float8) as notification`,
      );
      const read = <S extends Schema.Top & { readonly DecodingServices: never }>(
        schema: S,
        query: Effect.Effect<readonly unknown[], unknown>,
      ) =>
        query.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
          Effect.mapError(unavailable),
        );
      const write = Effect.fn("NotificationStore.postgres.write")(function* (
        query: Effect.Effect<unknown, unknown>,
      ) {
        yield* UnitOfWork.required;
        yield* query.pipe(Effect.mapError(unavailable));
      });
      return NotificationStore.of({
        insert: Effect.fn("NotificationStore.postgres.insert")(
          function* (notification, deliveries) {
            yield* write(
              sql`insert into notifications (id, recipient_kind, recipient_id, category, title, body, data, created_at, read_at) values (${notification.id}, ${notification.recipient.kind}, ${notification.recipient.id}, ${notification.category}, ${notification.title}, ${notification.body}, ${JSON.stringify(notification.data)}::jsonb, ${notification.createdAt}, ${notification.readAt})`,
            );
            for (const row of deliveries)
              yield* write(
                sql`insert into notification_deliveries (id, notification_id, recipient_kind, recipient_id, channel, mode, state, due_at, retry_at, sent_at, attempts, last_error) values (${row.id}, ${row.notificationId}, ${row.recipient.kind}, ${row.recipient.id}, ${row.channel}, ${row.mode}, ${row.state}, ${row.dueAt}, ${row.retryAt}, ${row.sentAt}, ${row.attempts}, ${row.lastError})`,
              );
          },
        ),
        list: (recipient, page) =>
          read(
            Notification,
            page.after === undefined
              ? sql`select ${columns} from notifications where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} order by created_at desc, id collate "C" desc limit ${page.size}`
              : sql`select ${columns} from notifications where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} and (created_at, id collate "C") < (${page.after.createdAt}, ${page.after.id}) order by created_at desc, id collate "C" desc limit ${page.size}`,
          ),
        unreadCount: (recipient) =>
          read(
            Schema.Struct({ count: Schema.Int }),
            sql`select count(*)::int as count from notifications where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} and read_at is null`,
          ).pipe(Effect.map((rows) => rows[0]?.count ?? 0)),
        markRead: Effect.fn("NotificationStore.postgres.markRead")(function* (recipient, at, id) {
          yield* UnitOfWork.required;
          const rows = yield* read(
            Notification,
            id === undefined
              ? sql`update notifications set read_at = ${at} where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} and read_at is null returning ${columns}`
              : sql`update notifications set read_at = ${at} where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} and id = ${id} and read_at is null returning ${columns}`,
          );
          return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
        }),
        preferences: (recipient) =>
          read(
            Preference,
            sql`select category, channel, mode from notification_preferences where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id} order by category collate "C", channel collate "C"`,
          ),
        setPreference: (recipient, preference) =>
          write(
            sql`insert into notification_preferences (recipient_kind, recipient_id, category, channel, mode) values (${recipient.kind}, ${recipient.id}, ${preference.category}, ${preference.channel}, ${preference.mode}) on conflict (recipient_kind, recipient_id, category, channel) do update set mode = excluded.mode`,
          ),
        quietHours: (recipient) =>
          read(
            QuietHours,
            sql`select start_time as start, end_time as end from notification_quiet_hours where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          ).pipe(Effect.map((rows) => rows[0] ?? null)),
        setQuietHours: (recipient, hours) =>
          write(
            hours === null
              ? sql`delete from notification_quiet_hours where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`
              : sql`insert into notification_quiet_hours (recipient_kind, recipient_id, start_time, end_time) values (${recipient.kind}, ${recipient.id}, ${hours.start}, ${hours.end}) on conflict (recipient_kind, recipient_id) do update set start_time = excluded.start_time, end_time = excluded.end_time`,
          ),
        timeZone: (recipient) =>
          read(
            Schema.Struct({ timeZone: TimeZone }),
            sql`select time_zone as "timeZone" from notification_time_zones where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          ).pipe(Effect.map((rows) => rows[0]?.timeZone ?? null)),
        setTimeZone: (recipient, timeZone) =>
          write(
            timeZone === null
              ? sql`delete from notification_time_zones where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`
              : sql`insert into notification_time_zones (recipient_kind, recipient_id, time_zone) values (${recipient.kind}, ${recipient.id}, ${timeZone}) on conflict (recipient_kind, recipient_id) do update set time_zone = excluded.time_zone`,
          ),
        deliveries: (recipient, query) =>
          read(
            DeliveryItem,
            sql`select ${deliveryColumns} from notification_deliveries d join notifications n on n.id = d.notification_id where d.recipient_kind = ${recipient.kind} and d.recipient_id = ${recipient.id} ${query?.unsettledOnly ? sql`and d.state in ('pending', 'held')` : sql``} order by d.id collate "C"`,
          ),
        delivery: (id) =>
          read(
            DeliveryItem,
            sql`select ${deliveryColumns} from notification_deliveries d join notifications n on n.id = d.notification_id where d.id = ${id}`,
          ).pipe(Effect.map((rows) => rows[0] ?? null)),
        reschedule: (id, schedule) =>
          write(
            sql`update notification_deliveries set mode = ${schedule.mode}, state = ${schedule.state}, due_at = ${schedule.dueAt} where id = ${id} and state in ('pending', 'held')`,
          ),
        due: (at, limit) =>
          read(
            DeliveryItem,
            sql`with eligible as (
              select *, case when mode = 'immediate' then jsonb_build_array(id)
                else jsonb_build_array(recipient_kind, recipient_id, channel, mode) end as group_key
              from notification_deliveries where state in ('pending', 'held') and due_at <= ${at}
            ), selected as (
              select group_key from eligible group by group_key
              order by min(due_at), min(id collate "C") limit ${limit}
            ) select ${deliveryColumns} from eligible d join selected s on s.group_key = d.group_key
              join notifications n on n.id = d.notification_id order by d.due_at, d.id collate "C"`,
          ),
        markSent: Effect.fn("NotificationStore.postgres.markSent")(function* (ids, at) {
          yield* UnitOfWork.required;
          for (const id of new Set(ids))
            yield* write(
              sql`update notification_deliveries set state = 'sent', sent_at = ${at}, attempts = attempts + 1, last_error = null where id = ${id} and state <> 'sent' and state not in ('failed', 'cancelled')`,
            );
        }),
        markFailed: (id, error, at, retry) =>
          write(
            sql`update notification_deliveries set
              state = case when attempts + 1 >= ${retry.maxAttempts} then 'failed' else 'pending' end,
              due_at = case when attempts + 1 >= ${retry.maxAttempts} then due_at
                else ${at}::bigint + least(${retry.baseMs}::numeric * power(2::numeric, attempts + 1), ${retry.capMs}::numeric)::bigint end,
              retry_at = case when attempts + 1 >= ${retry.maxAttempts} then retry_at
                else ${at}::bigint + least(${retry.baseMs}::numeric * power(2::numeric, attempts + 1), ${retry.capMs}::numeric)::bigint end,
              attempts = attempts + 1, last_error = ${error}
              where id = ${id} and state in ('pending', 'held')`,
          ),
        erase: Effect.fn("NotificationStore.postgres.erase")(function* (recipient) {
          yield* write(
            sql`delete from notifications where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          );
          yield* write(
            sql`delete from notification_preferences where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          );
          yield* write(
            sql`delete from notification_quiet_hours where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          );
          yield* write(
            sql`delete from notification_time_zones where recipient_kind = ${recipient.kind} and recipient_id = ${recipient.id}`,
          );
        }),
      });
    }),
  );

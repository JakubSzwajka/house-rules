import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { PushStore } from "../../storage.js";
import { type PushOwner, PushStoreUnavailable, PushSubscription } from "../../push/push.js";
const decode = Schema.decodeUnknownEffect(Schema.Array(PushSubscription));
export const postgresPushStore: Layer.Layer<PushStore, never, SqlClient> = Layer.effect(
  PushStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.map((rows) =>
          rows.map((value) => {
            if (typeof value !== "object" || value === null) return value;
            const row = { ...value } as Record<string, unknown>;
            if (row.userAgent === null) delete row.userAgent;
            if (row.expiredAt === null) delete row.expiredAt;
            return row;
          }),
        ),
        Effect.flatMap(decode),
        Effect.mapError((cause) => new PushStoreUnavailable({ cause })),
      );
    const write = (query: Effect.Effect<unknown, unknown>) =>
      Effect.gen(function* () {
        yield* UnitOfWork.required;
        yield* query.pipe(Effect.mapError((cause) => new PushStoreUnavailable({ cause })));
      });
    const columns = sql.literal(
      `endpoint, json_build_object('kind', owner_kind, 'id', owner_id) as owner, json_build_object('p256dh', p256dh, 'auth', auth) as keys, user_agent as "userAgent", created_at::float8 as "createdAt", expired_at::float8 as "expiredAt"`,
    );
    const listOwner = (owner: PushOwner) =>
      read(
        sql`select ${columns} from push_subscriptions where owner_kind = ${owner.kind} and owner_id = ${owner.id} and expired_at is null`,
      );
    return PushStore.of({
      get: (endpoint) =>
        read(
          sql`select ${columns} from push_subscriptions where endpoint = ${endpoint} and expired_at is null`,
        ).pipe(Effect.map((rows) => rows[0])),
      getIncludingExpired: (endpoint) =>
        read(sql`select ${columns} from push_subscriptions where endpoint = ${endpoint}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      listMine: listOwner,
      listOwner,
      put: (row) =>
        write(
          sql`insert into push_subscriptions (endpoint, owner_kind, owner_id, p256dh, auth, user_agent, created_at, expired_at) values (${row.endpoint}, ${row.owner.kind}, ${row.owner.id}, ${row.keys.p256dh}, ${row.keys.auth}, ${row.userAgent ?? null}, ${row.createdAt}, ${row.expiredAt ?? null}) on conflict (endpoint) do update set owner_kind = excluded.owner_kind, owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = excluded.created_at, expired_at = excluded.expired_at`,
        ),
      remove: (endpoint) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const result =
            yield* sql`delete from push_subscriptions where endpoint = ${endpoint} returning endpoint`.pipe(
              Effect.mapError((cause) => new PushStoreUnavailable({ cause })),
            );
          return result.length > 0;
        }),
      expired: (endpoint, at) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          const rows =
            yield* sql`update push_subscriptions set expired_at = ${at} where endpoint = ${endpoint} and expired_at is null returning endpoint`.pipe(
              Effect.mapError((cause) => new PushStoreUnavailable({ cause })),
            );
          return rows.length > 0;
        }),
      erase: (owner) =>
        write(
          sql`delete from push_subscriptions where owner_kind = ${owner.kind} and owner_id = ${owner.id}`,
        ),
    });
  }),
);

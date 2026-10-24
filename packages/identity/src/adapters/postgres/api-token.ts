import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { TokenRow } from "../../api-token/api-token.js";
import { ApiTokenStore } from "../../api-token/token-store.js";
import { IdentityStoreUnavailable } from "../../storage.js";

const decode = Schema.decodeUnknownEffect(Schema.Array(TokenRow));
const unavailable = (cause: unknown) => new IdentityStoreUnavailable({ cause });
export const postgresApiTokenStore = Layer.effect(
  ApiTokenStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const columns =
      sql.literal(`id::text as id, actor_id as "actorId", name, scopes, lookup, secret_hmac as "secretHmac",
    created_by as "createdBy", extract(epoch from created_at)::float8 * 1000 as "createdAt",
    extract(epoch from last_used_at)::float8 * 1000 as "lastUsedAt",
    extract(epoch from revoked_at)::float8 * 1000 as "revokedAt"`);
    const read = <E>(query: Effect.Effect<ReadonlyArray<unknown>, E>) =>
      query.pipe(Effect.flatMap(decode), Effect.mapError(unavailable));
    const write = Effect.fnUntraced(function* <A, E>(query: Effect.Effect<A, E>) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    return ApiTokenStore.of({
      find: (lookup) =>
        read(sql`select ${columns} from identity_api_token where lookup = ${lookup}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      insert: (row) =>
        write(sql`insert into identity_api_token (id, actor_id, name, scopes, lookup, secret_hmac, created_by, created_at, last_used_at, revoked_at)
      values (${row.id}, ${row.actorId}, ${row.name}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(row.scopes)}::jsonb)), ${row.lookup}, ${row.secretHmac}, ${row.createdBy},
      to_timestamp(${row.createdAt} / 1000.0), null, null)`),
      list: (actorId) =>
        read(
          actorId === undefined
            ? sql`select ${columns} from identity_api_token order by created_at desc, id`
            : sql`select ${columns} from identity_api_token where actor_id = ${actorId} order by created_at desc, id`,
        ),
      revoke: Effect.fnUntraced(function* (id, at) {
        yield* UnitOfWork.required;
        const before = (yield* read(
          sql`select ${columns} from identity_api_token where id = ${id} for update`,
        ))[0];
        if (before === undefined) return undefined;
        if (before.revokedAt !== null) return null;
        const after = (yield* read(
          sql`update identity_api_token set revoked_at = to_timestamp(${at} / 1000.0) where id = ${id} returning ${columns}`,
        ))[0];
        if (after === undefined) return yield* unavailable("Token changed during revocation.");
        return { before, after };
      }),
      recordUse: (id, at) =>
        write(
          sql`update identity_api_token set last_used_at = greatest(last_used_at, to_timestamp(${at} / 1000.0)) where id = ${id}`,
        ),
    });
  }),
);

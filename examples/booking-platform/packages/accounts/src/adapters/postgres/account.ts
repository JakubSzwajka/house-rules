import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { type Account, AccountId } from "../../account/account.js";
import { AccountStoreUnavailable } from "../../account/store-unavailable.js";
import { PasswordHash } from "../../password/password-hash.js";
import { AccountStore } from "../../storage.js";

const Row = Schema.Struct({
  id: AccountId,
  email: Schema.String,
  displayName: Schema.String,
  ...PasswordHash.fields,
  failedAttempts: Schema.Int,
  lockedUntil: Schema.NullOr(Schema.Int),
  createdAt: Schema.Int,
});

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const decodeCounts = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({ failedAttempts: Schema.Int, lockedUntil: Schema.NullOr(Schema.Int) }),
  ),
);
const unavailable = (cause: unknown) => new AccountStoreUnavailable({ cause });

const toAccount = ({ algorithm, iterations, salt, hash, ...row }: typeof Row.Type): Account => ({
  ...row,
  password: { algorithm, iterations, salt, hash },
});

export const postgresAccountStore: Layer.Layer<AccountStore, never, SqlClient> = Layer.effect(
  AccountStore,
  Effect.gen(function* postgresAccountStore() {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      `id, email, display_name as "displayName", password_algorithm as "algorithm",
      password_iterations as "iterations", password_salt as "salt", password_hash as "hash",
      failed_attempts as "failedAttempts",
      floor(extract(epoch from locked_until) * 1000)::float8 as "lockedUntil",
      floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"`,
    );
    const counts = sql.literal(
      `failed_attempts as "failedAttempts",
      floor(extract(epoch from locked_until) * 1000)::float8 as "lockedUntil"`,
    );
    const instant = (millis: number | null) =>
      sql`'epoch'::timestamptz + ${millis}::bigint * interval '1 millisecond'`;
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(decodeRows),
        Effect.map((rows) => rows.map(toAccount)[0]),
        Effect.mapError(unavailable),
      );
    const write = <A>(query: Effect.Effect<A, unknown>) =>
      UnitOfWork.required.pipe(Effect.andThen(query.pipe(Effect.mapError(unavailable))));
    return AccountStore.of({
      find: (id) => read(sql`select ${columns} from accounts_account where id = ${id}`),
      findByEmail: (email) =>
        read(sql`select ${columns} from accounts_account where email = ${email}`),
      insertIfFree: (account) =>
        write(sql`insert into accounts_account (id, email, display_name, password_algorithm,
            password_iterations, password_salt, password_hash, failed_attempts, locked_until,
            created_at)
          values (${account.id}, ${account.email}, ${account.displayName},
            ${account.password.algorithm}, ${account.password.iterations},
            ${account.password.salt}, ${account.password.hash}, ${account.failedAttempts},
            ${instant(account.lockedUntil)}, ${instant(account.createdAt)})
          on conflict do nothing returning id`).pipe(Effect.map((rows) => rows.length > 0)),
      // One statement, so concurrent failures all count and the lock lands with the last one.
      recordFailureIfUnlocked: (id, { now, failures, lockUntil }) =>
        write(
          sql`update accounts_account set
              failed_attempts = case when failed_attempts + 1 >= ${failures}::int then 0
                else failed_attempts + 1 end,
              locked_until = case when failed_attempts + 1 >= ${failures}::int
                then ${instant(lockUntil)} else null end
            where id = ${id} and (locked_until is null or locked_until <= ${instant(now)})
            returning ${counts}`.pipe(Effect.flatMap(decodeCounts)),
        ).pipe(Effect.map((rows) => rows[0])),
      // The lock is checked in the write itself, so a lock committed after the read still refuses.
      admitIfUnlocked: (id, { now, password }) =>
        write(sql`update accounts_account set failed_attempts = 0, locked_until = null
          where id = ${id} and password_hash = ${password.hash}
            and (locked_until is null or locked_until <= ${instant(now)})
          returning id`).pipe(Effect.map((rows) => rows.length > 0)),
      setPassword: (id, password) =>
        write(sql`update accounts_account set password_algorithm = ${password.algorithm},
            password_iterations = ${password.iterations}, password_salt = ${password.salt},
            password_hash = ${password.hash}, failed_attempts = 0, locked_until = null
          where id = ${id} returning id`).pipe(Effect.map((rows) => rows.length > 0)),
    });
  }),
);

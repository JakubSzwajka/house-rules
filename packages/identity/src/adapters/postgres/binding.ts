import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Binding, type BindingKey, IdentityStoreUnavailable } from "../../binding/binding.js";
import { BindingStore } from "../../storage.js";

const decodeHolders = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ actorId: ActorId })));
const decodeBindings = Schema.decodeUnknownEffect(Schema.Array(Binding));
const unavailable = (cause: unknown) => new IdentityStoreUnavailable({ cause });

export const postgresBindingStore: Layer.Layer<BindingStore, never, SqlClient> = Layer.effect(
  BindingStore,
  Effect.gen(function* postgresBindingStore() {
    const sql = yield* SqlClient;
    const holder = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(decodeHolders),
        Effect.map((rows) => rows[0]?.actorId),
        Effect.mapError(unavailable),
      );
    const find = (key: BindingKey) =>
      holder(sql`select actor_id as "actorId" from identity_binding
        where issuer = ${key.issuer} and subject = ${key.subject}`);
    const write = Effect.fn("BindingStore.postgres.write")(function* (
      query: Effect.Effect<unknown, unknown>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    return BindingStore.of({
      find,
      claim: Effect.fn("BindingStore.postgres.claim")(function* (
        key: BindingKey,
        actorId: ActorId,
      ) {
        yield* UnitOfWork.required;
        const inserted = yield* holder(sql`insert into identity_binding (issuer, subject, actor_id)
          values (${key.issuer}, ${key.subject}, ${actorId})
          on conflict (issuer, subject) do nothing returning actor_id as "actorId"`);
        if (inserted !== undefined) return inserted;
        // A separate statement sees a binding a concurrent unit committed while this insert waited.
        const held = yield* find(key);
        if (held === undefined) return yield* unavailable("The binding changed during the claim.");
        return held;
      }),
      remove: (actorId, key) =>
        write(sql`delete from identity_binding
          where issuer = ${key.issuer} and subject = ${key.subject} and actor_id = ${actorId}`),
      list: (actorId) =>
        sql`select issuer, subject, actor_id as "actorId",
            floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"
          from identity_binding where actor_id = ${actorId}
          order by issuer collate "C", subject collate "C"`.pipe(
          Effect.flatMap(decodeBindings),
          Effect.mapError(unavailable),
        ),
      removeAll: (actorId) => write(sql`delete from identity_binding where actor_id = ${actorId}`),
    });
  }),
);

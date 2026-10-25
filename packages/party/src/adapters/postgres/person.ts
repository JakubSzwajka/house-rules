import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Person, PersonStoreUnavailable } from "../../person/person.js";
import { PersonStore } from "../../storage.js";
import { legacyPrincipal, Principal } from "../../person/principal.js";

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Person));
const unavailable = (cause: unknown) => new PersonStoreUnavailable({ cause });

export const postgresPersonStore: Layer.Layer<PersonStore, never, SqlClient> = Layer.effect(
  PersonStore,
  Effect.gen(function* postgresPersonStore() {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      `id, display_name as "displayName", floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"`,
    );
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(Effect.flatMap(decodeRows), Effect.mapError(unavailable));
    const principalColumns = sql.literal(
      `id, display_name as "displayName", floor(extract(epoch from created_at) * 1000)::float8 as "createdAt",
       kind, handle, created_by as "createdBy", floor(extract(epoch from disabled_at) * 1000)::float8 as "disabledAt"`,
    );
    const readPrincipals = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Principal))),
        Effect.mapError(unavailable),
      );
    const insertPrincipal = Effect.fn("PersonStore.postgres.insertPrincipal")(function* (
      principal: Principal,
    ) {
      yield* UnitOfWork.required;
      const rows =
        yield* sql`insert into party_person (id, display_name, created_at, kind, handle, created_by, disabled_at)
        values (${principal.id}, ${principal.displayName},
          'epoch'::timestamptz + ${principal.createdAt}::bigint * interval '1 millisecond',
          ${principal.kind}, ${principal.handle}, ${principal.createdBy},
          'epoch'::timestamptz + ${principal.disabledAt}::bigint * interval '1 millisecond')
        on conflict do nothing returning id`.pipe(Effect.mapError(unavailable));
      return rows.length > 0;
    });
    return PersonStore.of({
      principal: (id) =>
        readPrincipals(sql`select ${principalColumns} from party_person where id = ${id}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      principalByHandle: (handle) =>
        readPrincipals(
          sql`select ${principalColumns} from party_person where handle = ${handle}`,
        ).pipe(Effect.map((rows) => rows[0])),
      principalsByIds: (ids) =>
        readPrincipals(
          sql`select ${principalColumns} from party_person where ${sql.in("id", ids)} order by id`,
        ),
      insertPrincipal,
      lockPrincipal: Effect.fn("PersonStore.postgres.lockPrincipal")(function* (handle) {
        yield* UnitOfWork.required;
        // FOR KEY SHARE would not block an UPDATE of disabled_at.
        const rows = yield* readPrincipals(
          sql`select ${principalColumns} from party_person where handle = ${handle} for share`,
        );
        return rows[0];
      }),
      principalForUpdate: Effect.fn("PersonStore.postgres.principalForUpdate")(function* (id) {
        yield* UnitOfWork.required;
        const rows = yield* readPrincipals(
          sql`select ${principalColumns} from party_person where id = ${id} for no key update`,
        );
        return rows[0];
      }),
      disable: Effect.fn("PersonStore.postgres.disable")(function* (id, disabledAt) {
        yield* UnitOfWork.required;
        const rows = yield* readPrincipals(sql`update party_person
          set disabled_at = coalesce(disabled_at, 'epoch'::timestamptz + ${disabledAt}::bigint * interval '1 millisecond')
          where id = ${id} returning ${principalColumns}`);
        return rows[0];
      }),
      find: (id) =>
        read(sql`select ${columns} from party_person where id = ${id}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      list: (ids) =>
        read(
          sql`select ${columns} from party_person where ${ids === null ? sql`true` : sql.in("id", ids)} order by display_name, id`,
        ),
      insertIfFree: (person) => insertPrincipal(legacyPrincipal(person)),
      rename: Effect.fn("PersonStore.postgres.rename")(function* (id, displayName) {
        yield* UnitOfWork.required;
        const rows = yield* read(
          sql`update party_person set display_name = ${displayName}
            where id = ${id} returning ${columns}`,
        );
        return rows[0];
      }),
      erase: Effect.fn("PersonStore.postgres.erase")(function* (id) {
        yield* UnitOfWork.required;
        yield* sql`delete from party_person where id = ${id}`.pipe(Effect.mapError(unavailable));
      }),
    });
  }),
);

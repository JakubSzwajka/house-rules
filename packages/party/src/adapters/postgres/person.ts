import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Person, PersonStoreUnavailable } from "../../person/person.js";
import { PersonStore } from "../../storage.js";

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
    return PersonStore.of({
      find: (id) =>
        read(sql`select ${columns} from party_person where id = ${id}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      insertIfFree: Effect.fn("PersonStore.postgres.insert")(function* (person: Person) {
        yield* UnitOfWork.required;
        const rows = yield* sql`insert into party_person (id, display_name, created_at)
          values (${person.id}, ${person.displayName},
            'epoch'::timestamptz + ${person.createdAt}::bigint * interval '1 millisecond')
          on conflict (id) do nothing returning id`.pipe(Effect.mapError(unavailable));
        return rows.length > 0;
      }),
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

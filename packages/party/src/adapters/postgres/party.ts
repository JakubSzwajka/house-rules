import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Assignment } from "../../assignment/assignment.js";
import { Organisation, PartyUnavailable } from "../../organisation/organisation.js";
import type { Relationship } from "../../relationship/relationship.js";
import { Role } from "../../role/role.js";
import { PartyStore } from "../../storage.js";

export const postgresPartyStore = Layer.effect(
  PartyStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const unavailable = (cause: unknown) => new PartyUnavailable({ cause });
    const read = <A, I, E>(
      schema: Schema.Codec<A, I>,
      query: Effect.Effect<readonly unknown[], E>,
    ) =>
      query.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
        Effect.mapError(unavailable),
      );
    const write = <A, E>(query: Effect.Effect<A, E>) =>
      UnitOfWork.required.pipe(
        Effect.andThen(query.pipe(Effect.mapError(unavailable))),
        Effect.asVoid,
      );
    const roleColumns = sql.literal(
      'key, name, permissions, organisation_id as "organisationId", false as "builtIn"',
    );
    const relation = (r: Relationship) => sql`from_kind = ${r.from.kind} and from_id = ${r.from.id}
    and to_kind = ${r.to.kind} and to_id = ${r.to.id} and kind = ${r.kind}`;
    return PartyStore.of({
      organisation: (id) =>
        read(Organisation, sql`select id, name from party_organisation where id = ${id}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      insertOrganisation: Effect.fn("PartyStore.postgres.insertOrganisation")(function* (value) {
        yield* UnitOfWork.required;
        const rows =
          yield* sql`insert into party_organisation (id, name) values (${value.id}, ${value.name})
        on conflict do nothing returning id`.pipe(Effect.mapError(unavailable));
        return rows.length > 0;
      }),
      relate: (r) =>
        write(sql`insert into party_relationship (from_kind, from_id, to_kind, to_id, kind)
      values (${r.from.kind}, ${r.from.id}, ${r.to.kind}, ${r.to.id}, ${r.kind}) on conflict do nothing`),
      unrelate: (r) => write(sql`delete from party_relationship where ${relation(r)}`),
      isRelated: (r) =>
        sql`select 1 from party_relationship where ${relation(r)}`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(unavailable),
        ),
      role: (key) =>
        read(Role, sql`select ${roleColumns} from party_role where key = ${key}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      roles: (organisationIds) =>
        read(
          Role,
          sql`select ${roleColumns} from party_role
        where ${organisationIds == null ? sql`true` : sql.in("organisation_id", organisationIds)} order by key`,
        ),
      putRole: (r) =>
        write(sql`insert into party_role (key, name, permissions, organisation_id)
      values (${r.key}, ${r.name}, array(select jsonb_array_elements_text(${JSON.stringify(r.permissions)}::jsonb)), ${r.organisationId})
      on conflict (key) do update set name = excluded.name, permissions = excluded.permissions, organisation_id = excluded.organisation_id`),
      deleteRole: Effect.fn("PartyStore.postgres.deleteRole")(function* (key) {
        yield* write(sql`delete from party_assignment where role_key = ${key}`);
        yield* write(sql`delete from party_role where key = ${key}`);
      }),
      assign: (a) =>
        write(sql`insert into party_assignment (person_id, role_key, organisation_id)
      values (${a.personId}, ${a.roleKey}, ${a.organisationId}) on conflict do nothing`),
      revoke: (a) =>
        write(sql`delete from party_assignment where person_id = ${a.personId}
      and role_key = ${a.roleKey} and organisation_id is not distinct from ${a.organisationId}::text`),
      assignments: (id, organisationIds, builtInKeys = []) =>
        read(
          Assignment,
          sql`select person_id as "personId", role_key as "roleKey",
      organisation_id as "organisationId" from party_assignment where person_id = ${id}
      and ${
        organisationIds == null
          ? sql`true`
          : sql`((${sql.in("organisation_id", organisationIds)}
          and (${sql.in("role_key", builtInKeys)} or exists
            (select 1 from party_role r where r.key = party_assignment.role_key
              and r.organisation_id = party_assignment.organisation_id)))
        or (organisation_id is null and ${sql.in("role_key", builtInKeys)}))`
      }
      order by role_key, organisation_id nulls first`,
        ),
    });
  }),
);

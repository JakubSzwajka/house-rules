import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Contact, ContactConflict, ContactStoreUnavailable } from "../../contact/contact.js";
import { ContactStore } from "../../storage.js";
const unavailable = (cause: unknown) => new ContactStoreUnavailable({ cause });
export const postgresContactStore: Layer.Layer<ContactStore, never, SqlClient> = Layer.effect(
  ContactStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      `c.id, json_build_object('kind', c.owner_kind, 'id', c.owner_id) as owner, c.type, c.value_normalized as "valueNormalized", c.details, c.purposes, array(select p.purpose from contact_primary_claims p where p.contact_id = c.id order by array_position(c.purposes, p.purpose)) as "primaryPurposes", c.verified_at::float8 as "verifiedAt", c.created_at::float8 as "createdAt"`,
    );
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Contact))),
        Effect.mapError(unavailable),
      );
    const ids = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String }))),
        ),
        Effect.mapError(unavailable),
      );
    const write = <A>(query: Effect.Effect<A, unknown>) =>
      UnitOfWork.required.pipe(Effect.andThen(query.pipe(Effect.mapError(unavailable))));
    const get = (id: string) =>
      read(sql`select ${columns} from contact_points c where c.id = ${id}`).pipe(
        Effect.map((rows) => rows[0]),
      );
    return ContactStore.of({
      get,
      list: (owner, page) =>
        read(
          page.after === undefined
            ? sql`select ${columns} from contact_points c where c.owner_kind = ${owner.kind} and c.owner_id = ${owner.id} order by c.created_at, c.id collate "C" limit ${page.size}`
            : sql`select ${columns} from contact_points c where c.owner_kind = ${owner.kind} and c.owner_id = ${owner.id} and (c.created_at, c.id collate "C") > (${page.after.createdAt}, ${page.after.id}) order by c.created_at, c.id collate "C" limit ${page.size}`,
        ),
      primaryFor: (owner, type, purpose, verifiedOnly) =>
        read(
          sql`select ${columns} from contact_points c join contact_primary_claims p on p.contact_id = c.id where p.owner_kind = ${owner.kind} and p.owner_id = ${owner.id} and p.type = ${type} and p.purpose = ${purpose} and (${!verifiedOnly} or c.verified_at is not null)`,
        ).pipe(Effect.map((rows) => rows[0])),
      insert: Effect.fn("ContactStore.postgres.insert")(function* (contact) {
        yield* UnitOfWork.required;
        const rows = yield* ids(
          sql`insert into contact_points (id, owner_kind, owner_id, type, value_normalized, details, purposes, verified_at, created_at) values (${contact.id}, ${contact.owner.kind}, ${contact.owner.id}, ${contact.type}, ${contact.valueNormalized}, ${JSON.stringify(contact.details)}::jsonb, array(select jsonb_array_elements_text(${JSON.stringify(contact.purposes)}::jsonb)), ${contact.verifiedAt}, ${contact.createdAt}) on conflict do nothing returning id`,
        );
        if (rows.length === 0) return yield* new ContactConflict();
      }),
      remove: (id) =>
        write(ids(sql`delete from contact_points where id = ${id} returning id`)).pipe(
          Effect.map((rows) => rows.length > 0),
        ),
      setPrimary: Effect.fn("ContactStore.postgres.setPrimary")(function* (id, purposes) {
        yield* UnitOfWork.required;
        const before = yield* get(id);
        if (!before) return undefined;
        // Serialize choices for an owner/type, including disjoint purpose sets.
        yield* write(
          sql`select pg_advisory_xact_lock(1668247156, hashtext(${JSON.stringify([before.owner.kind, before.owner.id, before.type])}))`,
        );
        const contact = (yield* read(
          sql`select ${columns} from contact_points c where c.id = ${id} for update`,
        ))[0];
        if (!contact) return undefined;
        const selected = (purposes ?? contact.purposes).filter((purpose) =>
          contact.purposes.includes(purpose),
        );
        const previous =
          yield* sql`delete from contact_primary_claims where owner_kind = ${contact.owner.kind} and owner_id = ${contact.owner.id} and type = ${contact.type} and contact_id <> ${id} and ${sql.in("purpose", selected)} returning purpose, contact_id as "contactId"`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(
                  Schema.Struct({
                    purpose: Schema.String,
                    contactId: Schema.String,
                  }),
                ),
              ),
            ),
            Effect.mapError(unavailable),
          );
        yield* write(
          sql`insert into contact_primary_claims (owner_kind, owner_id, type, purpose, contact_id) select ${contact.owner.kind}, ${contact.owner.id}, ${contact.type}, unnest(array(select jsonb_array_elements_text(${JSON.stringify(selected)}::jsonb))), ${id} on conflict do nothing`,
        );
        return {
          contact: {
            ...contact,
            primaryPurposes: contact.purposes.filter(
              (purpose) => selected.includes(purpose) || contact.primaryPurposes.includes(purpose),
            ),
          },
          previousContactIds: Object.fromEntries([
            ...selected
              .filter((purpose) => !contact.primaryPurposes.includes(purpose))
              .map((purpose) => [purpose, null]),
            ...previous.map((row) => [row.purpose, row.contactId]),
          ]),
        };
      }),
      importVerified: Effect.fn("ContactStore.postgres.importVerified")(function* (contact) {
        yield* UnitOfWork.required;
        // Match setPrimary's lock order before taking a contact row lock.
        yield* write(
          sql`select pg_advisory_xact_lock(1668247156, hashtext(${JSON.stringify([contact.owner.kind, contact.owner.id, contact.type])}))`,
        );
        const inserted = yield* ids(
          sql`insert into contact_points (id, owner_kind, owner_id, type, value_normalized, details, purposes, verified_at, created_at) values (${contact.id}, ${contact.owner.kind}, ${contact.owner.id}, ${contact.type}, ${contact.valueNormalized}, ${JSON.stringify(contact.details)}::jsonb, array(select jsonb_array_elements_text(${JSON.stringify(contact.purposes)}::jsonb)), ${contact.verifiedAt}, ${contact.createdAt}) on conflict (owner_kind, owner_id, type, value_normalized) do nothing returning id`,
        );
        if (inserted.length > 0) return { contact, added: true, verified: true };
        const existing = (yield* read(
          sql`select ${columns} from contact_points c where c.owner_kind = ${contact.owner.kind} and c.owner_id = ${contact.owner.id} and c.type = ${contact.type} and c.value_normalized = ${contact.valueNormalized} for update`,
        ))[0];
        if (!existing) return yield* unavailable("Imported contact disappeared.");
        if (existing.verifiedAt !== null)
          return { contact: existing, added: false, verified: false };
        const verified = (yield* write(
          read(
            sql`update contact_points c set verified_at = ${contact.verifiedAt}, token_hash = null, token_expires_at = null where c.id = ${existing.id} returning ${columns}`,
          ),
        ))[0];
        if (!verified) return yield* unavailable("Imported contact disappeared.");
        return { contact: verified, added: false, verified: true };
      }),
      replaceToken: (id, hash, expiresAt) =>
        write(
          ids(
            sql`update contact_points set token_hash = ${hash}, token_expires_at = ${expiresAt} where id = ${id} returning id`,
          ),
        ).pipe(Effect.map((rows) => rows.length > 0)),
      consumeToken: (hash, now) =>
        write(
          read(
            sql`update contact_points c set verified_at = ${now}, token_hash = null, token_expires_at = null where c.token_hash = ${hash} and c.token_expires_at > ${now} returning ${columns}`,
          ),
        ).pipe(Effect.map((rows) => rows[0])),
      erase: (owner) =>
        write(
          sql`delete from contact_points where owner_kind = ${owner.kind} and owner_id = ${owner.id}`,
        ).pipe(Effect.asVoid),
    });
  }),
);

import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { Hex } from "effect/encoding";
import { SqlClient } from "effect/sql/SqlClient";
import { ContactOwners, Contacts } from "../../index.js";
import { stores } from "./stores.js";
const world = Contacts.layer(Contacts.presets.default).pipe(
  Layer.provide(Layer.succeed(ContactOwners, { access: () => Effect.succeed("write") })),
  Layer.provideMerge(stores[0].layer),
);
layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
  "Postgres verification secrecy",
  (it) => {
    it.effect("persists only the hash and expiry and publishes no token columns", () =>
      Effect.gen(function* () {
        const service = yield* Contacts;
        const sql = yield* SqlClient;
        const added = yield* UnitOfWork.atomic(
          service.addContact(Actor.make({ id: ActorId.make("owner") }), {
            owner: { kind: "person", id: "owner" },
            type: "email",
            value: "owner@example.com",
            purposes: ["general"],
          }),
        );
        const issued = yield* UnitOfWork.atomic(service.issueVerificationToken(added.contact.id));
        const expectedHash = Hex.encode(
          new Uint8Array(
            yield* Effect.promise(() =>
              globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(issued.token)),
            ),
          ),
        );
        const stored =
          yield* sql`select token_hash as hash, token_expires_at::float8 as "expiresAt" from contact_points where id = ${added.contact.id}`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ hash: Schema.String, expiresAt: Schema.Int })),
              ),
            ),
          );
        expect(stored).toEqual([{ hash: expectedHash, expiresAt: issued.expiresAt }]);
        expect(stored[0]?.hash).not.toBe(issued.token);
        const published = yield* sql`select * from contacts_view where id = ${added.contact.id}`;
        expect(Object.keys(published[0] ?? {})).not.toContain("token_hash");
        expect(Object.keys(published[0] ?? {})).not.toContain("token_expires_at");
        expect(Object.keys(published[0] ?? {})).not.toContain("is_primary");
        yield* UnitOfWork.atomic(
          service.setPrimary(Actor.make({ id: ActorId.make("owner") }), added.contact.id),
        );
        const claims =
          yield* sql`select * from contact_primaries_view where contact_id = ${added.contact.id}`;
        expect(claims).toEqual([
          {
            owner_kind: "person",
            owner_id: "owner",
            type: "email",
            purpose: "general",
            contact_id: added.contact.id,
          },
        ]);
        expect(yield* sql`select * from contacts_view where id = ${added.contact.id}`).toHaveLength(
          1,
        );
        yield* UnitOfWork.atomic(service.verify(issued.token));
        const consumed =
          yield* sql`select token_hash as hash, token_expires_at as expiry from contact_points where id = ${added.contact.id}`;
        expect(consumed).toEqual([{ hash: null, expiry: null }]);
      }),
    );
  },
);

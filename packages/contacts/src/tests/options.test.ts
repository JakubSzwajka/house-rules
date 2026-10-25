import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  ContactDetails,
  ContactInputInvalid,
  ContactOwners,
  ContactOwnersUnavailable,
  Contacts,
  ContactsOptions,
  ContactStoreUnavailable,
} from "../index.js";
const owners = Layer.succeed(ContactOwners, { access: () => Effect.succeed("write") });
it.effect("rejects empty, duplicate and non-positive config values", () =>
  Effect.sync(() => {
    for (const options of [
      { ...Contacts.presets.default, allowedTypes: [] },
      { ...Contacts.presets.default, allowedTypes: ["email", "email"] },
      { ...Contacts.presets.default, purposes: [] },
      { ...Contacts.presets.default, purposes: ["general", "general"] },
      { ...Contacts.presets.default, verificationTokenTtlMs: 0 },
      { ...Contacts.presets.default, maxPageSize: -1 },
    ])
      expect(Schema.decodeUnknownExit(ContactsOptions)(options)._tag).toBe("Failure");
  }),
);
it.effect("validates options during acquisition", () =>
  Effect.gen(function* () {
    expect(
      yield* Effect.flip(
        Layer.build(
          Contacts.layerMemory({ ...Contacts.presets.default, maxPageSize: 0 }).pipe(
            Layer.provide(owners),
          ),
        ).pipe(Effect.scoped),
      ),
    ).toBeInstanceOf(ContactInputInvalid);
  }),
);
it.effect("enforces configured allowed types and preserves known and extra JSON details", () =>
  Effect.gen(function* () {
    const service = yield* Contacts;
    expect(
      yield* Effect.flip(
        UnitOfWork.atomic(
          service.addContact(Actor.make({ id: ActorId.make("a") }), {
            owner: { kind: "person", id: "a" },
            type: "phone",
            value: "123",
            purposes: ["general"],
          }),
        ),
      ),
    ).toBeInstanceOf(ContactInputInvalid);
    expect(
      yield* Schema.decodeEffect(ContactDetails)({
        country: "PL",
        extras: { floor: 2, code: null },
      }),
    ).toEqual({ country: "PL", extras: { floor: 2, code: null } });
  }).pipe(
    Effect.provide(
      Layer.merge(
        Contacts.layerMemory({ ...Contacts.presets.default, allowedTypes: ["email"] }).pipe(
          Layer.provide(owners),
        ),
        memoryUnitOfWork,
      ),
    ),
  ),
);
it.effect("keeps infrastructure details out of public messages", () =>
  Effect.sync(() => {
    expect(new ContactStoreUnavailable({ cause: "driver secret" }).message).toBe(
      "Contacts are unavailable. Try again shortly.",
    );
    expect(new ContactOwnersUnavailable({ cause: "party secret" }).message).toBe(
      "Contact owners are unavailable. Try again shortly.",
    );
  }),
);

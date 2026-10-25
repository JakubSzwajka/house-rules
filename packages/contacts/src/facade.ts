import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryContactStore } from "./adapters/memory/contact.js";
import { postgresContactStore } from "./adapters/postgres/contact.js";
import { ContactOwners } from "./contact/contact-owners.js";
import { ContactInputInvalid } from "./contact/contact.js";
import { type ContactsService, makeContacts } from "./contact/contacts.js";
import { ContactsOptions } from "./contact/options.js";
import { ContactStore } from "./storage.js";
export class Contacts extends defineModule<Contacts, ContactsService>()("contacts", {
  make: (options: ContactsOptions) =>
    Effect.gen(function* () {
      const settings = yield* Schema.decodeEffect(ContactsOptions)(options).pipe(
        Effect.mapError(() => new ContactInputInvalid({ message: "Invalid contacts options." })),
      );
      return makeContacts(yield* ContactStore, yield* ContactOwners, settings);
    }),
}) {
  static readonly presets = {
    default: {
      allowedTypes: ["email", "phone", "postal"],
      purposes: ["general"],
      verificationTokenTtlMs: 24 * 60 * 60 * 1000,
      maxPageSize: 100,
    },
  } as const;
  static readonly layerMemory = (options: ContactsOptions) =>
    this.layer(options).pipe(Layer.provide(memoryContactStore()));
  static readonly layerPostgres = (options: ContactsOptions) =>
    this.layer(options).pipe(Layer.provide(postgresContactStore));
}

import { Schema } from "effect";
import { ContactType } from "./contact.js";
const positive = Schema.Int.check(Schema.isGreaterThan(0));
export const ContactsOptions = Schema.Struct({
  allowedTypes: Schema.Array(ContactType).check(Schema.isMinLength(1)),
  purposes: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  verificationTokenTtlMs: positive,
  maxPageSize: positive,
}).check(
  Schema.makeFilter(
    (options) =>
      new Set(options.allowedTypes).size === options.allowedTypes.length &&
      new Set(options.purposes).size === options.purposes.length,
  ),
);
export type ContactsOptions = typeof ContactsOptions.Type;

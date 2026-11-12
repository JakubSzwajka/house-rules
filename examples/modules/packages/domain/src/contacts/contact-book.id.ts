import * as Schema from "effect/Schema";

export const ContactBookId = Schema.String.pipe(Schema.brand("ContactBookId"));
export type ContactBookId = typeof ContactBookId.Type;

export const ContactId = Schema.NonEmptyString;
export const Purposes = Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1));
export const ContactType = Schema.Literals(["email", "phone", "postal"]);
export type ContactType = typeof ContactType.Type;

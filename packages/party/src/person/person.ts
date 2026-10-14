import { ActorId } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120));
export type DisplayName = typeof DisplayName.Type;

export const Person = Schema.Struct({
  id: ActorId,
  displayName: DisplayName,
  createdAt: Schema.Int,
});
export type Person = typeof Person.Type;

export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()("PersonNotFound", {}) {}

export class PersonUpdateRefused extends Schema.TaggedError<PersonUpdateRefused>()(
  "PersonUpdateRefused",
  {},
) {}

export class PersonAlreadyExists extends Schema.TaggedError<PersonAlreadyExists>()(
  "PersonAlreadyExists",
  {},
) {}

export class PersonInputInvalid extends Schema.TaggedError<PersonInputInvalid>()(
  "PersonInputInvalid",
  { message: Schema.String },
) {}

export class PersonStoreUnavailable extends Schema.TaggedError<PersonStoreUnavailable>()(
  "PersonStoreUnavailable",
  { cause: Schema.Defect() },
) {}

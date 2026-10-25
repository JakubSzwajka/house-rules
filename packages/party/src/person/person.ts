import { ActorId, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120));
export type DisplayName = typeof DisplayName.Type;

export const Person = Schema.Struct({
  id: ActorId,
  displayName: DisplayName,
  createdAt: Schema.Int,
});
export type Person = typeof Person.Type;

export class PersonCallerDenied extends Schema.TaggedError<PersonCallerDenied>()(
  "PersonCallerDenied",
  { kind: errorKind("forbidden") },
) {}

export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()("PersonNotFound", {
  kind: errorKind("not_found"),
}) {}

export class PersonUpdateRefused extends Schema.TaggedError<PersonUpdateRefused>()(
  "PersonUpdateRefused",
  { kind: errorKind("forbidden") },
) {}

export class PersonAlreadyExists extends Schema.TaggedError<PersonAlreadyExists>()(
  "PersonAlreadyExists",
  { kind: errorKind("conflict") },
) {}

export class PersonInputInvalid extends Schema.TaggedError<PersonInputInvalid>()(
  "PersonInputInvalid",
  { kind: errorKind("invalid"), message: Schema.String },
) {}

export class PersonStoreUnavailable extends Schema.TaggedError<PersonStoreUnavailable>()(
  "PersonStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "People are unavailable. Try again shortly.";
  }
}

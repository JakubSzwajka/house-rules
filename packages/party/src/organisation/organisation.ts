import { errorKind } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";

export const OrganisationId = Schema.NonEmptyString;
export const Organisation = Schema.Struct({ id: OrganisationId, name: Schema.NonEmptyString });
export type Organisation = typeof Organisation.Type;
export const OrganisationRelation = Schema.Struct({
  ...Organisation.fields,
  relation: Schema.String,
});
export type OrganisationRelation = typeof OrganisationRelation.Type;
export const OwnOrganisation = Schema.Struct({
  ...Organisation.fields,
  relation: Schema.NullOr(Schema.String),
});
export type OwnOrganisation = typeof OwnOrganisation.Type;
export class PartyNotFound extends Schema.TaggedError<PartyNotFound>()("PartyNotFound", {
  kind: errorKind("not_found"),
}) {}
export class PartyInputInvalid extends Schema.TaggedError<PartyInputInvalid>()(
  "PartyInputInvalid",
  {
    kind: errorKind("invalid"),
    message: Schema.String,
  },
) {}
export class PartyDenied extends Schema.TaggedError<PartyDenied>()("PartyDenied", {
  kind: errorKind("forbidden"),
}) {
  override get message(): string {
    return "You do not have permission for this action in this scope.";
  }
}
export class PartyLastAdmin extends Schema.TaggedError<PartyLastAdmin>()("PartyLastAdmin", {
  kind: errorKind("conflict"),
  message: Schema.tag("An organisation must keep at least one administrator."),
}) {}
export class PartyConflict extends Schema.TaggedError<PartyConflict>()("PartyConflict", {
  kind: errorKind("conflict"),
}) {}
export class PartyUnavailable extends Schema.TaggedError<PartyUnavailable>()("PartyUnavailable", {
  kind: errorKind("unavailable"),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Party is unavailable. Try again shortly.";
  }
}
export const validateOrganisation = (input: Organisation) =>
  Schema.decodeEffect(Organisation)(input).pipe(
    Effect.mapError(() => new PartyInputInvalid({ message: "Invalid organisation." })),
  );

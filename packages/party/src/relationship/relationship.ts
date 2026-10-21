import { Effect, Schema } from "effect";
import { PartyInputInvalid } from "../organisation/organisation.js";

export const PartyReference = Schema.Struct({
  kind: Schema.Literals(["person", "organisation"]),
  id: Schema.NonEmptyString,
});
export type PartyReference = typeof PartyReference.Type;
export const Relationship = Schema.Struct({
  from: PartyReference,
  to: PartyReference,
  kind: Schema.NonEmptyString,
});
export type Relationship = typeof Relationship.Type;
export const validateRelationship = (input: Relationship) =>
  Schema.decodeEffect(Relationship)(input).pipe(
    Effect.mapError(() => new PartyInputInvalid({ message: "Invalid relationship." })),
  );

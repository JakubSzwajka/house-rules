import { ActorId } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
import { PartyInputInvalid } from "../organisation/organisation.js";

export const Assignment = Schema.Struct({
  personId: ActorId,
  roleKey: Schema.NonEmptyString,
  organisationId: Schema.NullOr(Schema.NonEmptyString),
});
export type Assignment = typeof Assignment.Type;
export const validateAssignment = (input: Assignment) =>
  Schema.decodeEffect(Assignment)(input).pipe(
    Effect.mapError(() => new PartyInputInvalid({ message: "Invalid role assignment." })),
  );

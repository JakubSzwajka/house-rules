import { Effect, Schema } from "effect";
import { PartyInputInvalid } from "../organisation/organisation.js";

export const RoleKey = Schema.NonEmptyString;
export const RolePermission = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/u),
);
export const Role = Schema.Struct({
  key: RoleKey,
  name: Schema.NonEmptyString,
  permissions: Schema.Array(RolePermission),
  organisationId: Schema.NullOr(Schema.NonEmptyString),
  builtIn: Schema.Boolean,
});
export type Role = typeof Role.Type;
export type BuiltInRoles = Readonly<
  Record<
    string,
    {
      readonly name: string;
      readonly permissions: readonly string[];
    }
  >
>;
export interface PartyOptions {
  readonly builtInRoles: BuiltInRoles;
  readonly holdersLimit?: number;
  readonly handles?: {
    readonly pattern?: RegExp;
    readonly reserved?: readonly string[];
  };
}
export const validateRole = (input: Role) =>
  Schema.decodeEffect(Role)(input).pipe(
    Effect.mapError(() => new PartyInputInvalid({ message: "Invalid role or permission." })),
  );

import { ActorId, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { Person } from "./person.js";

export const PrincipalKind = Schema.Literals(["person", "agent"]);
export type PrincipalKind = typeof PrincipalKind.Type;
export const PrincipalHandle = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
export const Principal = Schema.Struct({
  ...Person.fields,
  kind: PrincipalKind,
  handle: Schema.String,
  createdBy: Schema.NullOr(ActorId),
  disabledAt: Schema.NullOr(Schema.Int),
});
export type Principal = typeof Principal.Type;
export const CreatePrincipal = Schema.Struct({
  id: Schema.optionalKey(ActorId),
  displayName: Schema.String,
  kind: PrincipalKind,
  handle: Schema.String,
  createdBy: Schema.NullOr(ActorId),
});
export type CreatePrincipal = typeof CreatePrincipal.Type;

export const PrincipalCreated = Schema.Struct({
  kind: Schema.Literal("principal.created"),
  after: Principal,
});
export const PrincipalDisabled = Schema.Struct({
  kind: Schema.Literal("principal.disabled"),
  before: Principal,
  after: Principal,
});
export const CreatedPrincipal = Schema.Struct({ principal: Principal, fact: PrincipalCreated });
export type CreatedPrincipal = typeof CreatedPrincipal.Type;
export const DisabledPrincipal = Schema.Struct({
  principal: Principal,
  fact: Schema.NullOr(PrincipalDisabled),
});
export type DisabledPrincipal = typeof DisabledPrincipal.Type;

export class PrincipalDisabledRefused extends Schema.TaggedError<PrincipalDisabledRefused>()(
  "PrincipalDisabledRefused",
  { kind: errorKind("forbidden") },
) {}
export class PrincipalKindRefused extends Schema.TaggedError<PrincipalKindRefused>()(
  "PrincipalKindRefused",
  { kind: errorKind("forbidden") },
) {}

export const legacyPrincipal = (person: Person): Principal => ({
  ...person,
  kind: "person",
  handle: person.id,
  createdBy: null,
  disabledAt: null,
});
export const personOf = ({ id, displayName, createdAt }: Person): Person => ({
  id,
  displayName,
  createdAt,
});

import * as Schema from "effect/Schema";

export const PersonId = Schema.String.pipe(Schema.brand("PersonId"));
export type PersonId = typeof PersonId.Type;

export const Person = Schema.TaggedStruct("Person", {
  id: PersonId,
  orgId: Schema.NullOr(Schema.String),
  roles: Schema.Array(Schema.String),
  permissions: Schema.Array(Schema.String),
});
export type Person = typeof Person.Type;

export const System = Schema.TaggedStruct("System", {
  name: Schema.String,
  permissions: Schema.Array(Schema.String),
});
export type System = typeof System.Type;

export const Actor = Schema.Union([Person, System]);
export type Actor = typeof Actor.Type;

export const person = (
  id: string,
  options: {
    readonly roles?: ReadonlyArray<string>;
    readonly permissions?: ReadonlyArray<string>;
    readonly orgId?: string | null;
  } = {},
): Person => ({
  _tag: "Person",
  id: PersonId.make(id),
  orgId: options.orgId ?? null,
  roles: [...(options.roles ?? [])],
  permissions: [...(options.permissions ?? [])],
});

export const system = (name: string, permissions: ReadonlyArray<string> = []): System => ({
  _tag: "System",
  name,
  permissions: [...permissions],
});

export const authorOf = (actor: Actor): string =>
  actor._tag === "Person" ? actor.id : `system:${actor.name}`;

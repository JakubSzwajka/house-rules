import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const PartyId = Schema.String.pipe(Schema.brand("PartyId"));
export type PartyId = typeof PartyId.Type;

export const agentIdPrefix = "agent:";

const isAgentId = (id: string): boolean =>
  id.startsWith(agentIdPrefix) && id.length > agentIdPrefix.length;

export const PersonId = PartyId.check(
  Schema.makeFilter((id: string) => !id.startsWith(agentIdPrefix), {
    expected: `a person id that does not start with "${agentIdPrefix}"`,
  }),
).pipe(Schema.brand("PersonId"));
export type PersonId = typeof PersonId.Type;

export const AgentId = PartyId.check(
  Schema.makeFilter(isAgentId, { expected: `an agent id that starts with "${agentIdPrefix}"` }),
).pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

export const Person = Schema.TaggedStruct("Person", {
  id: PersonId,
  orgId: Schema.NullOr(Schema.String),
  roles: Schema.Array(Schema.String),
  permissions: Schema.Array(Schema.String),
});
export type Person = typeof Person.Type;

export const Agent = Schema.TaggedStruct("Agent", {
  id: AgentId,
  name: Schema.String,
  forPerson: PersonId,
  orgId: Schema.NullOr(Schema.String),
  roles: Schema.Array(Schema.String),
  permissions: Schema.Array(Schema.String),
});
export type Agent = typeof Agent.Type;

export const System = Schema.TaggedStruct("System", {
  name: Schema.String,
  permissions: Schema.Array(Schema.String),
});
export type System = typeof System.Type;

export const Actor = Schema.Union([Person, Agent, System]);
export type Actor = typeof Actor.Type;

export type Party = Person | Agent;

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

export const agent = (
  id: string,
  forPerson: string,
  options: {
    readonly name?: string;
    readonly roles?: ReadonlyArray<string>;
    readonly permissions?: ReadonlyArray<string>;
    readonly orgId?: string | null;
  } = {},
): Agent => ({
  _tag: "Agent",
  id: AgentId.make(id),
  name: options.name ?? id,
  forPerson: PersonId.make(forPerson),
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
  actor._tag === "System" ? `system:${actor.name}` : actor.id;

export const ActedFor = Schema.NullOr(PersonId).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
  Schema.withConstructorDefault(Effect.succeed(null)),
);

export interface Attribution {
  readonly by: string;
  readonly for: PersonId | null;
}

export const attributionOf = (actor: Actor): Attribution => ({
  by: authorOf(actor),
  for: actor._tag === "Agent" ? actor.forPerson : null,
});

export const partyOf = (actor: Actor): PartyId | null =>
  actor._tag === "System" ? null : actor.id;

export const actingFor = (actor: Actor): PersonId | null => {
  switch (actor._tag) {
    case "Person":
      return actor.id;
    case "Agent":
      return actor.forPerson;
    case "System":
      return null;
  }
};

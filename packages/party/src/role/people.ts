import type { ActorId, Caller } from "@house-rules/domain";
import { Effect } from "effect";
import { PartyDenied, PartyNotFound, type PartyUnavailable } from "../organisation/organisation.js";
import type { PartyStore, PersonStore } from "../storage.js";
import type { Role } from "./role.js";

export const makePeople = (
  store: PartyStore["Service"],
  persons: {
    readonly list: (
      ids: readonly ActorId[] | null,
    ) => Effect.Effect<
      Effect.Success<ReturnType<PersonStore["Service"]["list"]>>,
      PartyUnavailable
    >;
  },
  role: (key: string) => Effect.Effect<Role | undefined, PartyUnavailable>,
  adminScopes: (caller: Caller) => Effect.Effect<string[] | null, PartyDenied | PartyUnavailable>,
  organisationExists: (id: string | null) => Effect.Effect<void, PartyNotFound | PartyUnavailable>,
) => {
  const assignmentDetails = Effect.fn("Party.assignmentDetails")(function* (
    personId: ActorId,
    scopes: readonly string[] | null,
  ) {
    return yield* Effect.forEach(
      yield* store.scopedAssignments(personId, scopes),
      Effect.fnUntraced(function* (a) {
        const held = yield* role(a.roleKey);
        const org =
          a.organisationId === null ? undefined : yield* store.organisation(a.organisationId);
        return {
          roleKey: a.roleKey,
          roleName: held?.name ?? a.roleKey,
          organisationId: a.organisationId,
          organisationName: org?.name ?? null,
        };
      }),
    );
  });
  return {
    listPeople: Effect.fn("Party.listPeople")(function* (caller: Caller) {
      const scopes = yield* adminScopes(caller);
      return yield* Effect.forEach(
        yield* persons.list(scopes === null ? null : yield* store.memberIds(scopes)),
        Effect.fnUntraced(function* (person) {
          return {
            ...person,
            assignments: yield* assignmentDetails(person.id, scopes),
            organisations: yield* store.relationsFor(person.id, scopes),
          };
        }),
      );
    }),
    listMembers: Effect.fn("Party.listMembers")(function* (caller: Caller, organisationId: string) {
      const scopes = yield* adminScopes(caller).pipe(
        Effect.catchTag("PartyDenied", () => new PartyNotFound()),
      );
      if (scopes !== null && !scopes.includes(organisationId)) return yield* new PartyNotFound();
      yield* organisationExists(organisationId);
      return yield* Effect.forEach(
        yield* persons.list(yield* store.memberIds([organisationId])),
        Effect.fnUntraced(function* (person) {
          const relations = yield* store.relationsFor(person.id, [organisationId]);
          return {
            ...person,
            relation: relations[0]?.relation ?? null,
            roles: (yield* assignmentDetails(person.id, [organisationId])).map(
              ({ roleKey, roleName }) => ({ roleKey, roleName }),
            ),
          };
        }),
      );
    }),
    myOrganisations: Effect.fn("Party.myOrganisations")(function* (caller: Caller) {
      if (caller.kind !== "person") return yield* new PartyDenied();
      return yield* Effect.forEach(
        yield* store.organisationsFor(caller.actor.id),
        Effect.fnUntraced(function* (org) {
          const roles = yield* Effect.forEach(
            yield* store.scopedAssignments(caller.actor.id, [org.id]),
            Effect.fnUntraced(function* (a) {
              const held = yield* role(a.roleKey);
              return {
                roleKey: a.roleKey,
                roleName: held?.name ?? a.roleKey,
                permissions: held?.permissions ?? [],
              };
            }),
          );
          return { ...org, roles };
        }),
      );
    }),
  };
};

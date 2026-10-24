import {
  type Caller,
  type ActorId,
  type Permission,
  type PersonCaller,
  UnitOfWork,
} from "@house-rules/domain";
import { Effect } from "effect";
import { makePeople } from "./people.js";
import { makeInvitations } from "../invitation/invitations.js";
import { type Assignment, validateAssignment } from "../assignment/assignment.js";
import {
  type Organisation,
  PartyConflict,
  PartyDenied,
  PartyInputInvalid,
  PartyNotFound,
  PartyUnavailable,
  validateOrganisation,
} from "../organisation/organisation.js";
import {
  type Relationship,
  type PartyReference,
  validateRelationship,
} from "../relationship/relationship.js";
import type { PartyStore, PersonStore } from "../storage.js";
import { removeStaffAssignments } from "../relationship/removal.js";
import type { RoleCatalogue } from "./permission-catalogue.js";
import { type PartyOptions, type Role, validateRole } from "./role.js";

export const makeAccess = (
  store: PartyStore["Service"],
  persons: {
    readonly find: (id: ActorId) => Effect.Effect<unknown, PartyUnavailable>;
    readonly principal: (
      id: ActorId,
    ) => Effect.Effect<{ readonly disabledAt: number | null } | undefined, PartyUnavailable>;
    readonly list: (
      ids: readonly ActorId[] | null,
    ) => Effect.Effect<
      Effect.Success<ReturnType<PersonStore["Service"]["list"]>>,
      PartyUnavailable
    >;
  },
  options: PartyOptions,
  catalogue: RoleCatalogue | undefined,
) => {
  const builtIns: readonly Role[] = Object.entries(options.builtInRoles).map(([key, role]) => ({
    key,
    name: role.name,
    permissions: [...role.permissions],
    builtIn: true,
    organisationId: null,
  }));
  const role = (key: string) => {
    const builtIn = builtIns.find((r) => r.key === key);
    return builtIn ? Effect.succeed(builtIn) : store.role(key);
  };
  const permissionsOf = Effect.fn("Party.permissionsOf")(function* (caller: PersonCaller) {
    const principal = yield* persons.principal(caller.actor.id);
    if (principal && principal.disabledAt !== null) return [];
    const allowed = catalogue ? new Set(yield* catalogue.permissions()) : undefined;
    const permissions = new Set<Permission>();
    for (const assignment of yield* store.assignments(caller.actor.id)) {
      const held = yield* role(assignment.roleKey);
      if (
        !held ||
        (held.organisationId !== null && held.organisationId !== assignment.organisationId)
      )
        continue;
      for (const p of held.permissions)
        if (!allowed || allowed.has(p as Permission)) permissions.add(p as Permission);
    }
    return [...permissions].sort();
  });
  const admin = Effect.fn("Party.admin")(function* (caller: Caller, organisationId: string | null) {
    if (caller.kind !== "person") return yield* new PartyDenied();
    const allowed = catalogue ? new Set(yield* catalogue.permissions()) : undefined;
    if (allowed && !allowed.has("party:admin")) return yield* new PartyDenied();
    for (const assignment of yield* store.assignments(caller.actor.id)) {
      const held = yield* role(assignment.roleKey);
      if (
        held &&
        (held.organisationId === null || held.organisationId === assignment.organisationId) &&
        held.permissions.includes("party:admin") &&
        (assignment.organisationId === null || assignment.organisationId === organisationId)
      )
        return;
    }
    return yield* new PartyDenied();
  });
  const mayDelegate = Effect.fn("Party.mayDelegate")(function* (
    caller: Caller,
    permissions: readonly string[],
    organisationId: string | null,
  ) {
    if (caller.kind === "system") return;
    const held = new Set<string>();
    for (const assignment of yield* store.assignments(caller.actor.id)) {
      if (assignment.organisationId !== null && assignment.organisationId !== organisationId)
        continue;
      const assigned = yield* role(assignment.roleKey);
      if (
        assigned &&
        (assigned.organisationId === null || assigned.organisationId === assignment.organisationId)
      )
        for (const permission of assigned.permissions) held.add(permission);
    }
    if (permissions.some((permission) => !held.has(permission))) return yield* new PartyDenied();
  });
  const visibleScopes = Effect.fn("Party.visibleScopes")(function* (caller: Caller) {
    if (caller.kind === "system") return null;
    const scopes = new Set<string>();
    for (const assignment of yield* store.assignments(caller.actor.id)) {
      const held = yield* role(assignment.roleKey);
      if (
        !held ||
        (held.organisationId !== null && held.organisationId !== assignment.organisationId)
      )
        continue;
      if (assignment.organisationId === null) {
        if (held.permissions.includes("party:admin")) return null;
      } else scopes.add(assignment.organisationId);
    }
    return [...scopes];
  });
  const organisationExists = Effect.fn("Party.organisationExists")(function* (id: string | null) {
    if (id !== null && !(yield* store.organisation(id))) return yield* new PartyNotFound();
  });
  const partyExists = Effect.fn("Party.partyExists")(function* (ref: PartyReference) {
    const found =
      ref.kind === "person"
        ? yield* persons.find(ref.id as ActorId)
        : yield* store.organisation(ref.id);
    if (!found) return yield* new PartyNotFound();
  });
  const relationScope = Effect.fn("Party.relationScope")(function* (
    caller: Caller,
    r: Relationship,
  ) {
    // A scoped admin must control every organisation in a relation, not merely one endpoint.
    const organisations = [r.from, r.to].filter((p) => p.kind === "organisation");
    if (organisations.length === 0) yield* admin(caller, null);
    for (const org of organisations) yield* admin(caller, org.id);
  });
  const adminScopes = Effect.fn("Party.adminScopes")(function* (caller: Caller) {
    if (caller.kind !== "person") return yield* new PartyDenied();
    const scopes = new Set<string>();
    if (catalogue && !(yield* catalogue.permissions()).includes("party:admin"))
      return yield* new PartyDenied();
    for (const assignment of yield* store.assignments(caller.actor.id)) {
      const held = yield* role(assignment.roleKey);
      if (
        !held ||
        !held.permissions.includes("party:admin") ||
        (held.organisationId !== null && held.organisationId !== assignment.organisationId)
      )
        continue;
      if (assignment.organisationId === null) return null;
      scopes.add(assignment.organisationId);
    }
    if (scopes.size === 0) return yield* new PartyDenied();
    return [...scopes];
  });
  const checkInvitationRole = Effect.fn("Party.checkInvitationRole")(function* (
    caller: Caller,
    key: string,
    org: string,
  ) {
    yield* admin(caller, org);
    const held = yield* role(key);
    if (!held) return yield* new PartyNotFound();
    if (held.organisationId !== null && held.organisationId !== org)
      return yield* new PartyDenied();
    yield* mayDelegate(caller, held.permissions, org);
  });
  return {
    ...makeInvitations(store, admin, checkInvitationRole),
    ...makePeople(store, persons, role, adminScopes, organisationExists),
    permissionsOf,
    canAdminOrganisation: Effect.fn("Party.canAdminOrganisation")(function* (
      caller: Caller,
      organisationId: string,
    ) {
      if (!(yield* store.organisation(organisationId))) return false;
      return yield* admin(caller, organisationId).pipe(
        Effect.as(true),
        Effect.catchTag("PartyDenied", () => Effect.succeed(false)),
      );
    }),
    myAccess: Effect.fn("Party.myAccess")(function* (caller: Caller) {
      if (caller.kind !== "person") return yield* new PartyDenied();
      return {
        roles: yield* store.assignments(caller.actor.id),
        permissions: yield* permissionsOf(caller),
        catalogue: catalogue ? [...(yield* catalogue.permissions())].sort() : [],
      };
    }),
    createOrganisation: Effect.fn("Party.createOrganisation")(function* (
      caller: Caller,
      input: Organisation,
    ) {
      yield* UnitOfWork.required;
      if (caller.kind !== "person") return yield* new PartyDenied();
      const value = yield* validateOrganisation(input);
      if (!(yield* store.insertOrganisation(value))) return yield* new PartyConflict();
      yield* store.relate({
        from: { kind: "person", id: caller.actor.id },
        to: { kind: "organisation", id: value.id },
        kind: "staff",
      });
      return value;
    }),
    showOrganisation: Effect.fn("Party.showOrganisation")(function* (id: string) {
      const value = yield* store.organisation(id);
      if (!value) return yield* new PartyNotFound();
      return value;
    }),
    relate: Effect.fn("Party.relate")(function* (caller: Caller, input: Relationship) {
      yield* UnitOfWork.required;
      const value = yield* validateRelationship(input);
      yield* relationScope(caller, value);
      yield* partyExists(value.from);
      yield* partyExists(value.to);
      yield* store.relate(value);
    }),
    unrelate: Effect.fn("Party.unrelate")(function* (caller: Caller, input: Relationship) {
      yield* UnitOfWork.required;
      const value = yield* validateRelationship(input);
      yield* relationScope(caller, value);
      yield* removeStaffAssignments(store, role, value);
      yield* store.unrelate(value);
    }),
    isRelated: (input: Relationship) =>
      validateRelationship(input).pipe(Effect.flatMap(store.isRelated)),
    defineRole: Effect.fn("Party.defineRole")(function* (
      caller: Caller,
      input: Omit<Role, "builtIn">,
    ) {
      yield* UnitOfWork.required;
      const value = yield* validateRole({ ...input, builtIn: false });
      yield* admin(caller, value.organisationId);
      if (builtIns.some((r) => r.key === value.key)) return yield* new PartyConflict();
      const previous = yield* store.role(value.key);
      if (previous) yield* admin(caller, previous.organisationId);
      yield* organisationExists(value.organisationId);
      if (!catalogue)
        return yield* new PartyUnavailable({ cause: "Permission catalogue not mounted" });
      const allowed = new Set(yield* catalogue.permissions());
      if (value.permissions.some((p) => !allowed.has(p as Permission)))
        return yield* new PartyInputInvalid({ message: "Unknown role permission." });
      yield* mayDelegate(caller, value.permissions, value.organisationId);
      yield* store.putRole(value);
      return value;
    }),
    deleteRole: Effect.fn("Party.deleteRole")(function* (caller: Caller, key: string) {
      yield* UnitOfWork.required;
      const value = yield* role(key);
      if (!value) return yield* new PartyNotFound();
      yield* admin(caller, value.organisationId);
      if (value.builtIn) return yield* new PartyConflict();
      yield* store.deleteRole(key);
    }),
    listRoles: Effect.fn("Party.listRoles")(function* (caller: Caller) {
      return [...builtIns, ...(yield* store.roles(yield* visibleScopes(caller)))];
    }),
    assignRole: Effect.fn("Party.assignRole")(function* (caller: Caller, input: Assignment) {
      yield* UnitOfWork.required;
      const value = yield* validateAssignment(input);
      // Trusted first sign-in can assign a default role without person authority.
      if (caller.kind !== "system") yield* admin(caller, value.organisationId);
      yield* organisationExists(value.organisationId);
      if (!(yield* persons.find(value.personId))) return yield* new PartyNotFound();
      const held = yield* role(value.roleKey);
      if (!held) return yield* new PartyNotFound();
      if (held.organisationId !== null && held.organisationId !== value.organisationId)
        return yield* new PartyDenied();
      yield* mayDelegate(caller, held.permissions, value.organisationId);
      yield* store.assign(value);
    }),
    revokeRole: Effect.fn("Party.revokeRole")(function* (caller: Caller, input: Assignment) {
      yield* UnitOfWork.required;
      const value = yield* validateAssignment(input);
      yield* admin(caller, value.organisationId);
      yield* store.revoke(value);
    }),
    rolesOf: Effect.fn("Party.rolesOf")(function* (caller: Caller, personId: ActorId) {
      return yield* store.assignments(
        personId,
        yield* visibleScopes(caller),
        builtIns.map((r) => r.key),
      );
    }),
  };
};

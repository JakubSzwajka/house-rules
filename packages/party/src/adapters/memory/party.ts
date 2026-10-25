import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import type { StoredInvitation } from "../../invitation/invitation.js";
import type { Assignment } from "../../assignment/assignment.js";
import type { Organisation } from "../../organisation/organisation.js";
import type { Relationship } from "../../relationship/relationship.js";
import type { Role } from "../../role/role.js";
import { PartyStore } from "../../storage.js";

export const memoryPartyStore = (): Layer.Layer<PartyStore> =>
  Layer.sync(PartyStore, () => {
    const organisations = new Map<string, Organisation>();
    const relationships = new Map<string, Relationship>();
    const roles = new Map<string, Role>();
    const assignments = new Map<string, Assignment>();
    const invitations = new Map<string, StoredInvitation>();
    const copy = <A>(value: A): A => structuredClone(value);
    const key = (value: Relationship | Assignment) => JSON.stringify(value);
    const change = Effect.fn("PartyStore.memory.change")(function* <A>(run: () => A) {
      yield* UnitOfWork.required;
      const before = [
        new Map(organisations),
        new Map(relationships),
        new Map(roles),
        new Map(assignments),
        new Map(invitations),
      ] as const;
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          organisations.clear();
          for (const [k, v] of before[0]) organisations.set(k, v);
          relationships.clear();
          for (const [k, v] of before[1]) relationships.set(k, v);
          roles.clear();
          for (const [k, v] of before[2]) roles.set(k, v);
          assignments.clear();
          for (const [k, v] of before[3]) assignments.set(k, v);
          invitations.clear();
          for (const [k, v] of before[4]) invitations.set(k, v);
        }),
      );
      return run();
    });
    const changeAssignment = Effect.fnUntraced(function* (value: Assignment, assigned: boolean) {
      yield* UnitOfWork.required;
      let undo: (() => void) | undefined;
      yield* UnitOfWork.onRollback(Effect.sync(() => undo?.()));
      yield* Effect.sync(() => {
        // Keep one previous entry, not a growing snapshot for every assignment in the unit.
        const id = key(value);
        const before = assignments.get(id);
        undo = () => {
          if (before === undefined) assignments.delete(id);
          else assignments.set(id, before);
        };
        if (assigned) assignments.set(id, copy(value));
        else assignments.delete(id);
      });
    });
    return PartyStore.of({
      organisation: (id) => Effect.sync(() => copy(organisations.get(id))),
      organisationsFor: (id) =>
        Effect.sync(() =>
          copy(
            [...organisations.values()]
              .filter(
                (org) =>
                  [...relationships.values()].some(
                    (r) =>
                      r.from.kind === "person" &&
                      r.from.id === id &&
                      r.to.kind === "organisation" &&
                      r.to.id === org.id,
                  ) ||
                  [...assignments.values()].some(
                    (a) => a.personId === id && a.organisationId === org.id,
                  ),
              )
              .map((org) => ({
                ...org,
                relation:
                  [...relationships.values()]
                    .filter(
                      (r) =>
                        r.from.kind === "person" &&
                        r.from.id === id &&
                        r.to.kind === "organisation" &&
                        r.to.id === org.id,
                    )
                    .map((r) => r.kind)
                    .sort()[0] ?? null,
              }))
              .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
          ),
        ),
      relationsFor: (id, scopes) =>
        Effect.sync(() =>
          copy(
            [...relationships.values()]
              .flatMap((r) => {
                const org = organisations.get(r.to.id);
                return r.from.kind === "person" &&
                  r.from.id === id &&
                  r.to.kind === "organisation" &&
                  org &&
                  (scopes === null || scopes.includes(org.id))
                  ? [{ ...org, relation: r.kind }]
                  : [];
              })
              .sort(
                (a, b) =>
                  a.name.localeCompare(b.name) ||
                  a.id.localeCompare(b.id) ||
                  a.relation.localeCompare(b.relation),
              ),
          ),
        ),
      scopedAssignments: (id, scopes) =>
        Effect.sync(() =>
          copy(
            [...assignments.values()]
              .filter(
                (a) =>
                  a.personId === id &&
                  (scopes === null ||
                    (a.organisationId !== null && scopes.includes(a.organisationId))),
              )
              .sort(
                (a, b) =>
                  a.roleKey.localeCompare(b.roleKey) ||
                  (a.organisationId ?? "").localeCompare(b.organisationId ?? ""),
              ),
          ),
        ),
      assignmentsInOrganisation: (id) =>
        Effect.sync(() => copy([...assignments.values()].filter((a) => a.organisationId === id))),
      holderIds: (role, scope, take) =>
        Effect.sync(() =>
          [
            ...new Set(
              [...assignments.values()]
                .filter((a) => a.roleKey === role && a.organisationId === scope)
                .map((a) => a.personId),
            ),
          ]
            .sort()
            .slice(0, take),
        ),
      lockOrganisation: () => UnitOfWork.required,
      memberIds: (ids) =>
        Effect.sync(() => [
          ...new Set(
            [...relationships.values()]
              .filter(
                (r) =>
                  r.from.kind === "person" &&
                  r.to.kind === "organisation" &&
                  ids.includes(r.to.id) &&
                  r.kind === "staff",
              )
              .map((r) => ActorId.make(r.from.id)),
          ),
        ]),
      insertInvitation: (value) =>
        change(() => {
          invitations.set(value.id, copy(value));
        }),
      invitation: (id) => Effect.sync(() => copy(invitations.get(id))),
      invitations: (id) =>
        Effect.sync(() => copy([...invitations.values()].filter((i) => i.organisationId === id))),
      consumeInvitation: (hash, now) =>
        change(() => {
          const found = [...invitations.values()].find(
            (i) => i.codeHash === hash && i.state === "pending" && i.expiresAt > now,
          );
          if (!found) return undefined;
          invitations.set(found.id, { ...found, state: "used" });
          return copy(found);
        }),
      revokeInvitation: (id) =>
        change(() => {
          const found = invitations.get(id);
          if (found) invitations.set(id, { ...found, state: "revoked" });
        }),
      insertOrganisation: (value) =>
        change(() => {
          if (organisations.has(value.id)) return false;
          organisations.set(value.id, copy(value));
          return true;
        }),
      relate: (value) =>
        change(() => {
          relationships.set(key(value), copy(value));
        }),
      unrelate: (value) =>
        change(() => {
          relationships.delete(key(value));
        }),
      isRelated: (value) => Effect.sync(() => relationships.has(key(value))),
      role: (id) => Effect.sync(() => copy(roles.get(id))),
      roles: (organisationIds) =>
        Effect.sync(() =>
          copy(
            [...roles.values()]
              .filter(
                (r) =>
                  organisationIds == null ||
                  (r.organisationId !== null && organisationIds.includes(r.organisationId)),
              )
              .sort((a, b) => a.key.localeCompare(b.key)),
          ),
        ),
      putRole: (value) =>
        change(() => {
          roles.set(value.key, copy(value));
        }),
      deleteRole: (id) =>
        change(() => {
          roles.delete(id);
          for (const [k, v] of assignments) if (v.roleKey === id) assignments.delete(k);
        }),
      assign: (value) => changeAssignment(value, true),
      revoke: (value) => changeAssignment(value, false),
      assignments: (id, organisationIds, builtInKeys = []) =>
        Effect.sync(() =>
          copy(
            [...assignments.values()].filter(
              (a) =>
                a.personId === id &&
                (organisationIds == null ||
                  (a.organisationId === null
                    ? builtInKeys.includes(a.roleKey)
                    : organisationIds.includes(a.organisationId) &&
                      (builtInKeys.includes(a.roleKey) ||
                        roles.get(a.roleKey)?.organisationId === a.organisationId))),
            ),
          ),
        ),
    });
  });

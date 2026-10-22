import { Effect } from "effect";
import { PartyLastAdmin, type PartyUnavailable } from "../organisation/organisation.js";
import type { PartyStore } from "../storage.js";
import type { Relationship } from "./relationship.js";

export const removeStaffAssignments = Effect.fn("Party.removeStaffAssignments")(function* (
  store: PartyStore["Service"],
  role: (
    key: string,
  ) => Effect.Effect<
    { readonly organisationId: string | null; readonly permissions: readonly string[] } | undefined,
    PartyUnavailable
  >,
  value: Relationship,
) {
  if (value.from.kind !== "person" || value.to.kind !== "organisation" || value.kind !== "staff")
    return;
  // Serialize removals so two admins cannot each see the other one and both leave.
  yield* store.lockOrganisation(value.to.id);
  const assignments = yield* store.assignmentsInOrganisation(value.to.id);
  const admins = new Set<string>();
  for (const assignment of assignments) {
    const held = yield* role(assignment.roleKey);
    if (
      held &&
      (held.organisationId === null || held.organisationId === value.to.id) &&
      held.permissions.includes("party:admin")
    )
      admins.add(assignment.personId);
  }
  if (admins.has(value.from.id) && admins.size === 1) return yield* new PartyLastAdmin();
  for (const assignment of assignments)
    if (assignment.personId === value.from.id) yield* store.revoke(assignment);
});

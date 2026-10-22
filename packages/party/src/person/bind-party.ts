import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import type { makeAccess } from "../role/access.js";
import type { makeParty } from "./party.js";
import { PartyOperations } from "./operations.js";
import { PersonCallerDenied, PersonNotFound, PersonUpdateRefused } from "./person.js";

type Service = ReturnType<typeof makeParty> & ReturnType<typeof makeAccess>;

export const bindParty = (service: Service): readonly Binding[] => [
  bindOperation(PartyOperations.canAdminOrganisation, ({ organisationId }, { caller }) =>
    service.canAdminOrganisation(caller, organisationId),
  ),
  bindOperation(PartyOperations.createInvitation, (input, { caller }) =>
    service.createInvitation(caller, input),
  ),
  bindOperation(PartyOperations.acceptInvitation, ({ code }, { caller }) =>
    service.acceptInvitation(caller, code),
  ),
  bindOperation(PartyOperations.revokeInvitation, ({ id }, { caller }) =>
    service.revokeInvitation(caller, id),
  ),
  bindOperation(PartyOperations.listInvitations, ({ organisationId }, { caller }) =>
    service.listInvitations(caller, organisationId),
  ),
  bindOperation(PartyOperations.myOrganisations, (_input, { caller }) =>
    service.myOrganisations(caller),
  ),
  bindOperation(PartyOperations.listMembers, ({ organisationId }, { caller }) =>
    service.listMembers(caller, organisationId),
  ),
  bindOperation(PartyOperations.listPeople, (_input, { caller }) => service.listPeople(caller)),
  bindOperation(PartyOperations.myAccess, (_input, { caller }) => service.myAccess(caller)),
  bindOperation(PartyOperations.createOrganisation, (input, { caller }) =>
    service.createOrganisation(caller, input),
  ),
  bindOperation(PartyOperations.showOrganisation, ({ id }) => service.showOrganisation(id)),
  bindOperation(PartyOperations.relate, (input, { caller }) => service.relate(caller, input)),
  bindOperation(PartyOperations.unrelate, (input, { caller }) => service.unrelate(caller, input)),
  bindOperation(PartyOperations.isRelated, (input) => service.isRelated(input)),
  bindOperation(PartyOperations.defineRole, (input, { caller }) =>
    service.defineRole(caller, input),
  ),
  bindOperation(PartyOperations.deleteRole, ({ key }, { caller }) =>
    service.deleteRole(caller, key),
  ),
  bindOperation(PartyOperations.listRoles, (_input, { caller }) => service.listRoles(caller)),
  bindOperation(PartyOperations.assignRole, (input, { caller }) =>
    service.assignRole(caller, input),
  ),
  bindOperation(PartyOperations.revokeRole, (input, { caller }) =>
    service.revokeRole(caller, input),
  ),
  bindOperation(PartyOperations.rolesOf, ({ personId }, { caller }) =>
    service.rolesOf(caller, personId),
  ),
  bindOperation(PartyOperations.createPerson, (input, { caller }) =>
    caller.kind === "system" ? service.createPerson(input) : Effect.fail(new PersonCallerDenied()),
  ),
  bindOperation(PartyOperations.showPerson, ({ id }, { caller }) =>
    caller.kind === "person" ? service.get(caller.actor, id) : Effect.fail(new PersonNotFound()),
  ),
  bindOperation(PartyOperations.showMe, (_input, { caller }) =>
    caller.kind === "person" ? service.me(caller.actor) : Effect.fail(new PersonNotFound()),
  ),
  bindOperation(PartyOperations.renamePerson, ({ id, displayName }, { caller }) =>
    caller.kind === "person"
      ? service.rename(caller.actor, id, displayName)
      : Effect.fail(new PersonUpdateRefused()),
  ),
];

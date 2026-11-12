import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PersonId, Session } from "@house-rules/stack";
import { LastAdmin } from "./last-admin.rejection.ts";
import { NotAdmin } from "./not-admin.rejection.ts";
import { NotMember } from "./not-member.rejection.ts";
import { OrgId, RoleName } from "./organisation.id.ts";
import { OrganisationNotFound } from "./organisation-not-found.rejection.ts";

export class OrganisationMemberRoleChanged extends Domain.Event("OrganisationMemberRoleChanged", {
  person: PersonId,
  role: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class ChangeMemberRole extends Domain.Command("ChangeMemberRole", {
  target: OrgId,
  middleware: [Session],
  input: { person: PersonId, role: RoleName },
  events: [OrganisationMemberRoleChanged],
  rejects: [Forbidden, NotAdmin, OrganisationNotFound, NotMember, LastAdmin],
}) {}

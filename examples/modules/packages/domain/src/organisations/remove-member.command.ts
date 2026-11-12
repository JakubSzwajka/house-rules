import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PersonId, Session } from "@house-rules/stack";
import { LastAdmin } from "./last-admin.rejection.ts";
import { NotAdmin } from "./not-admin.rejection.ts";
import { NotMember } from "./not-member.rejection.ts";
import { OrgId } from "./organisation.id.ts";
import { OrganisationNotFound } from "./organisation-not-found.rejection.ts";

export class OrganisationMemberRemoved extends Domain.Event("OrganisationMemberRemoved", {
  person: PersonId,
  by: Schema.String,
  for: ActedFor,
}) {}

export class RemoveMember extends Domain.Command("RemoveMember", {
  target: OrgId,
  middleware: [Session],
  input: { person: PersonId },
  events: [OrganisationMemberRemoved],
  rejects: [Forbidden, NotAdmin, OrganisationNotFound, NotMember, LastAdmin],
}) {}

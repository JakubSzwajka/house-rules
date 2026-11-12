import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotAdmin } from "./not-admin.rejection.ts";
import { OrgId, RoleName } from "./organisation.id.ts";
import { OrganisationNotFound } from "./organisation-not-found.rejection.ts";

export class AlreadyMember extends Domain.Rejection(
  "AlreadyMember",
  { person: PersonId, role: Schema.String },
  { httpApiStatus: 409 },
) {}

export class OrganisationMemberAdded extends Domain.Event("OrganisationMemberAdded", {
  person: PersonId,
  role: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class AddMember extends Domain.Command("AddMember", {
  target: OrgId,
  middleware: [Session],
  input: { person: PersonId, role: RoleName },
  events: [OrganisationMemberAdded],
  rejects: [Forbidden, NotAdmin, OrganisationNotFound, AlreadyMember],
}) {}

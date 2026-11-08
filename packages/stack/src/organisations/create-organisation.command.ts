import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { OrgId } from "./organisation.id.ts";

export class OrganisationExists extends Domain.Rejection(
  "OrganisationExists",
  {},
  { httpApiStatus: 409 },
) {}

export class AdminRequired extends Domain.Rejection("AdminRequired", {}, { httpApiStatus: 400 }) {}

export class OrganisationCreated extends Domain.Event("OrganisationCreated", {
  name: Schema.String,
  admin: PersonId,
  by: Schema.String,
}) {}

export class CreateOrganisation extends Domain.Command("CreateOrganisation", {
  target: OrgId,
  middleware: [Session],
  input: { name: Schema.NonEmptyString, admin: Schema.optional(PersonId) },
  events: [OrganisationCreated],
  rejects: [Forbidden, OrganisationExists, AdminRequired],
}) {}

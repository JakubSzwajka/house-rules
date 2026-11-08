import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { PersonId } from "../actor/actor.ts";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class WorkItemAssigned extends Domain.Event("WorkItemAssigned", {
  from: Schema.NullOr(PersonId),
  to: Schema.NullOr(PersonId),
  by: Schema.String,
}) {}

export class AssignWorkItem extends Domain.Command("AssignWorkItem", {
  target: WorkItemId,
  middleware: [Session],
  input: { holder: Schema.NullOr(PersonId) },
  events: [WorkItemAssigned],
  rejects: [Forbidden, WorkItemNotFound],
}) {}

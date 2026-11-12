import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PartyId, Session } from "@house-rules/stack";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class WorkItemAssigned extends Domain.Event("WorkItemAssigned", {
  from: Schema.NullOr(PartyId),
  to: Schema.NullOr(PartyId),
  by: Schema.String,
  for: ActedFor,
}) {}

export class AssignWorkItem extends Domain.Command("AssignWorkItem", {
  target: WorkItemId,
  middleware: [Session],
  input: { holder: Schema.NullOr(PartyId) },
  events: [WorkItemAssigned],
  rejects: [Forbidden, WorkItemNotFound],
}) {}

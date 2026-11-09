import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { TransitionNotAllowed } from "./transition-not-allowed.rejection.ts";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";
import { WorkflowConfig } from "./workflow-config.middleware.ts";
import { ActedFor } from "../actor/actor.ts";

export class WorkItemStatusChanged extends Domain.Event("WorkItemStatusChanged", {
  from: Schema.String,
  to: Schema.String,
  closedAt: Schema.NullOr(Schema.Int),
  by: Schema.String,
  for: ActedFor,
}) {}

export class ChangeWorkItemStatus extends Domain.Command("ChangeWorkItemStatus", {
  target: WorkItemId,
  middleware: [Session, WorkflowConfig],
  input: { status: Schema.String },
  events: [WorkItemStatusChanged],
  rejects: [Forbidden, WorkItemNotFound, TransitionNotAllowed],
}) {}

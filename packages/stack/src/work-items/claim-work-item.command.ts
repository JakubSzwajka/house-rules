import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { PartyId } from "../actor/actor.ts";
import { TransitionNotAllowed } from "./transition-not-allowed.rejection.ts";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";
import { WorkflowConfig } from "./workflow-config.middleware.ts";

export class WorkItemClaimed extends Domain.Event("WorkItemClaimed", {
  holder: PartyId,
  from: Schema.String,
  to: Schema.String,
  by: Schema.String,
}) {}

export class WorkItemClosed extends Domain.Rejection(
  "WorkItemClosed",
  { status: Schema.String },
  { httpApiStatus: 409 },
) {}

export class WorkItemHeld extends Domain.Rejection(
  "WorkItemHeld",
  { holder: PartyId },
  { httpApiStatus: 409 },
) {}

export class ClaimWorkItem extends Domain.Command("ClaimWorkItem", {
  target: WorkItemId,
  middleware: [Session, WorkflowConfig],
  events: [WorkItemClaimed],
  rejects: [Forbidden, WorkItemNotFound, WorkItemClosed, WorkItemHeld, TransitionNotAllowed],
}) {}

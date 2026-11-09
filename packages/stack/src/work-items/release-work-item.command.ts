import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { PartyId } from "../actor/actor.ts";
import { TransitionNotAllowed } from "./transition-not-allowed.rejection.ts";
import { WorkItemId } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";
import { WorkflowConfig } from "./workflow-config.middleware.ts";

export class WorkItemReleased extends Domain.Event("WorkItemReleased", {
  holder: Schema.NullOr(PartyId),
  from: Schema.String,
  to: Schema.String,
  closedAt: Schema.NullOr(Schema.Int),
  by: Schema.String,
}) {}

export class NotHolder extends Domain.Rejection(
  "NotHolder",
  { holder: PartyId },
  { httpApiStatus: 403 },
) {}

export class ReleaseWorkItem extends Domain.Command("ReleaseWorkItem", {
  target: WorkItemId,
  middleware: [Session, WorkflowConfig],
  events: [WorkItemReleased],
  rejects: [Forbidden, WorkItemNotFound, NotHolder, TransitionNotAllowed],
}) {}

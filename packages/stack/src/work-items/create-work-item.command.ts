import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { WorkItemBody, WorkItemId, WorkItemTitle } from "./work-item.id.ts";
import { WorkflowConfig } from "./workflow-config.middleware.ts";

export class WorkItemCreated extends Domain.Event("WorkItemCreated", {
  title: Schema.String,
  body: Schema.String,
  status: Schema.String,
  closedAt: Schema.NullOr(Schema.Int),
  container: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(WorkItemId),
  by: Schema.String,
}) {}

export class WorkItemExists extends Domain.Rejection(
  "WorkItemExists",
  {},
  { httpApiStatus: 409 },
) {}

export class CreateWorkItem extends Domain.Command("CreateWorkItem", {
  target: WorkItemId,
  middleware: [Session, WorkflowConfig],
  input: {
    title: WorkItemTitle,
    body: Schema.optionalKey(WorkItemBody),
    container: Schema.optionalKey(Schema.NullOr(Schema.String)),
    parent: Schema.optionalKey(Schema.NullOr(WorkItemId)),
  },
  events: [WorkItemCreated],
  rejects: [Forbidden, WorkItemExists],
}) {}

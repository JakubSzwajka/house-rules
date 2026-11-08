import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { WorkItemBody, WorkItemId, WorkItemTitle } from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class WorkItemEdited extends Domain.Event("WorkItemEdited", {
  title: Schema.String,
  body: Schema.String,
  by: Schema.String,
}) {}

export class EditWorkItem extends Domain.Command("EditWorkItem", {
  target: WorkItemId,
  middleware: [Session],
  input: { title: Schema.optionalKey(WorkItemTitle), body: Schema.optionalKey(WorkItemBody) },
  events: [WorkItemEdited],
  rejects: [Forbidden, WorkItemNotFound],
}) {}

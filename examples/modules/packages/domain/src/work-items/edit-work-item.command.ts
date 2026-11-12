import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session } from "@house-rules/stack";
import {
  DueField,
  PriorityField,
  WorkItemBody,
  WorkItemDue,
  WorkItemId,
  WorkItemPriority,
  WorkItemTitle,
} from "./work-item.id.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";

export class WorkItemEdited extends Domain.Event("WorkItemEdited", {
  title: Schema.String,
  body: Schema.String,
  priority: PriorityField,
  due: DueField,
  by: Schema.String,
  for: ActedFor,
}) {}

export class EditWorkItem extends Domain.Command("EditWorkItem", {
  target: WorkItemId,
  middleware: [Session],
  input: {
    title: Schema.optionalKey(WorkItemTitle),
    body: Schema.optionalKey(WorkItemBody),
    priority: Schema.optionalKey(Schema.NullOr(WorkItemPriority)),
    due: Schema.optionalKey(Schema.NullOr(WorkItemDue)),
  },
  events: [WorkItemEdited],
  rejects: [Forbidden, WorkItemNotFound],
}) {}
